// src/bot/photo.ts
// Фото: транзакционная работа + advisory lock на user_id (BIGINT).
// Цели:
//  • Единые лимиты и хелперы (count/freeSlots)
//  • Безопасные вставки (антидубликаты, ловим 23505)
//  • Редактирование: setMain, delete, reorder — атомарно
//  • Одна реализация для регистрации и редактирования

import TelegramBot, { PhotoSize } from "node-telegram-bot-api";
import { query, withTx } from "../db.js";

/* =========================
   КОНСТАНТЫ ЛИМИТОВ
   ========================= */
export const MAX_PROFILE_PHOTOS = 5;        // максимум в профиле
export const MAX_IMPORT_PER_CALL = 5;       // верхняя граница импортов за вызов
export const MAX_UPLOAD_PER_SESSION = 3;    // разовый лимит пользовательской загрузки (UI)

// РЕКОМЕНДУЕМЫЕ ИНДЕКСЫ:
// CREATE UNIQUE INDEX IF NOT EXISTS photos_user_file_uniq ON photos(user_id, file_id);
// CREATE INDEX IF NOT EXISTS photos_user_pos_idx ON photos(user_id, pos);
// CREATE INDEX IF NOT EXISTS photos_user_main_idx ON photos(user_id) WHERE is_main;

/* =========================
   УТИЛИТЫ
   ========================= */

export async function countUserPhotos(userId: number): Promise<number> {
  const r = await query<{ c: number }>("SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1", [userId]);
  return r.rows[0]?.c ?? 0;
}
export async function freeSlots(userId: number): Promise<number> {
  const count = await countUserPhotos(userId);
  return Math.max(0, MAX_PROFILE_PHOTOS - count);
}

/**
 * Выбрать «лучший» размер из набора telegram PhotoSize:
 *  • приоритет — площадь, затем размер файла.
 */
export function getBestPhotoSize(photos: PhotoSize[]): PhotoSize | null {
  if (!photos || photos.length === 0) return null;
  const sorted = photos.slice().sort((a, b) => {
    const areaA = (a.width || 0) * (a.height || 0);
    const areaB = (b.width || 0) * (b.height || 0);
    if (areaA !== areaB) return areaB - areaA;
    return (b.file_size || 0) - (a.file_size || 0);
  });
  return sorted[0];
}

/**
 * Мягкая валидация входящих фото.
 */
export function validatePhoto(photo: PhotoSize): { valid: boolean; error?: string } {
  const maxSizeBytes = 5 * 1024 * 1024; // 5 MB
  if (photo.file_size && photo.file_size > maxSizeBytes) {
    return { valid: false, error: "Размер фото слишком большой. Максимум 5MB." };
  }
  if (photo.width && photo.height) {
    const minSide = 100, maxSide = 4096;
    if (photo.width < minSide || photo.height < minSide) {
      return { valid: false, error: "Фото слишком маленькое. Минимум 100x100 пикселей." };
    }
    if (photo.width > maxSide || photo.height > maxSide) {
      return { valid: false, error: "Фото слишком большое. Максимум 4096x4096 пикселей." };
    }
  }
  return { valid: true };
}

/* =========================
   БАЗОВЫЕ ОПЕРАЦИИ
   ========================= */

/**
 * Атомарно добавляет фото пользователю.
 * — advisory lock на user_id
 * — соблюдение лимита и позиций
 * — auto-main, если ещё нет главного
 * — игнор дублей (по UNIQUE user_id,file_id) через ловлю 23505
 */
export async function addPhotoSafely(
  userId: number,
  fileId: string
): Promise<{ position: number; total: number; madeMain: boolean } | { skippedDuplicate: true; total: number }> {
  return withTx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [userId]);

    const cntRes = await client.query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1",
      [userId]
    );
    const count = cntRes.rows[0]?.c ?? 0;
    if (count >= MAX_PROFILE_PHOTOS) throw new Error("LIMIT_REACHED");

    const maxRes = await client.query<{ m: number }>(
      "SELECT COALESCE(MAX(pos),0) AS m FROM photos WHERE user_id=$1",
      [userId]
    );
    const nextPos = (maxRes.rows[0]?.m ?? 0) + 1;

    const mainRes = await client.query(
      "SELECT 1 FROM photos WHERE user_id=$1 AND is_main=true LIMIT 1",
      [userId]
    );
    const makeMain = mainRes.rowCount === 0;

    try {
      await client.query(
        "INSERT INTO photos(user_id, file_id, pos, is_main) VALUES ($1,$2,$3,$4)",
        [userId, fileId, nextPos, makeMain]
      );
      return { position: nextPos, total: count + 1, madeMain: makeMain };
    } catch (e: any) {
      // duplicate (user_id, file_id)
      if (e?.code === "23505") {
        return { skippedDuplicate: true, total: count };
      }
      throw e;
    }
  });
}

/**
 * Импорт из Telegram-профиля (без скачивания — только file_id).
 * — до limit
 * — не превышаем свободные слоты
 * — антидубликаты
 * — auto-main, если нет
 */
export async function importPhotosFromTelegramProfile(
  bot: TelegramBot,
  userId: number,
  opts: { replace?: boolean; limit?: number } = {}
): Promise<number> {
  const raw = await bot.getUserProfilePhotos(userId, { limit: 100 });
  const groups = raw.photos || [];
  if (!groups.length) return 0;

  const limit = Math.max(1, Math.min(MAX_IMPORT_PER_CALL, opts.limit ?? MAX_IMPORT_PER_CALL));

  return withTx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [userId]);

    if (opts.replace) {
      await client.query("DELETE FROM photos WHERE user_id=$1", [userId]);
    }

    let cntRes = await client.query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1",
      [userId]
    );
    let count = cntRes.rows[0]?.c ?? 0;
    const free = Math.max(0, MAX_PROFILE_PHOTOS - count);
    if (free === 0) return 0;

    let inserted = 0;
    for (const group of groups) {
      if (inserted >= limit || count >= MAX_PROFILE_PHOTOS) break;

      const best = getBestPhotoSize(group);
      if (!best) continue;

      // пропустим дубли без запроса, полагаясь на уникальный индекс и ловлю 23505
      const maxRes = await client.query<{ m: number }>(
        "SELECT COALESCE(MAX(pos),0) AS m FROM photos WHERE user_id=$1",
        [userId]
      );
      const nextPos = (maxRes.rows[0]?.m ?? 0) + 1;

      const mainRes = await client.query(
        "SELECT 1 FROM photos WHERE user_id=$1 AND is_main=true LIMIT 1",
        [userId]
      );
      const makeMain = mainRes.rowCount === 0;

      try {
        await client.query(
          "INSERT INTO photos(user_id, file_id, pos, is_main) VALUES ($1,$2,$3,$4)",
          [userId, best.file_id, nextPos, makeMain]
        );
        inserted++;
        count++;
      } catch (e: any) {
        if (e?.code === "23505") {
          // дубликат — просто пропускаем
          continue;
        }
        throw e;
      }
    }

    // гарантируем наличие главного
    const chk = await client.query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1 AND is_main=true",
      [userId]
    );
    if ((chk.rows[0]?.c ?? 0) === 0) {
      await client.query(
        `
        WITH first AS (
          SELECT id FROM photos
          WHERE user_id=$1
          ORDER BY pos ASC, id ASC
          LIMIT 1
        )
        UPDATE photos
        SET is_main=true
        WHERE id IN (SELECT id FROM first)
      `,
        [userId]
      );
    }

    return inserted;
  });
}

/**
 * Получить все file_id для карусели (главное — первым).
 */
export async function getAllUserPhotos(userId: number): Promise<string[]> {
  const r = await query<{ file_id: string }>(
    `
    SELECT file_id
    FROM photos
    WHERE user_id = $1
    ORDER BY is_main DESC, pos ASC, id ASC
  `,
    [userId]
  );
  return r.rows.map((x) => x.file_id);
}

/**
 * Фото из Telegram-профиля пользователя (для предпросмотра, без импорта в БД).
 */
export async function getTelegramProfilePhotosForPreview(
  bot: TelegramBot,
  userId: number,
  limit: number = MAX_IMPORT_PER_CALL
): Promise<string[]> {
  try {
    const raw = await bot.getUserProfilePhotos(userId, { limit: 100 });
    const groups = raw.photos || [];
    if (!groups.length) return [];

    const out: string[] = [];
    for (const group of groups) {
      if (out.length >= limit) break;
      const best = getBestPhotoSize(group);
      if (best) out.push(best.file_id);
    }
    return out;
  } catch {
    return [];
  }
}

/* =========================
   ОПЕРАЦИИ ДЛЯ РЕДАКТИРОВАНИЯ
   ========================= */

/**
 * Сделать фото главным по его file_id.
 */
export async function setMainPhoto(userId: number, fileId: string): Promise<void> {
  await withTx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [userId]);

    await client.query(
      "UPDATE photos SET is_main=false WHERE user_id=$1 AND is_main=true",
      [userId]
    );
    const r = await client.query(
      "UPDATE photos SET is_main=true WHERE user_id=$1 AND file_id=$2",
      [userId, fileId]
    );
    if (r.rowCount === 0) {
      throw new Error("PHOTO_NOT_FOUND");
    }
  });
}

/**
 * Удалить фото по file_id. Если удаляем главное — назначаем новое главное (самое раннее по pos).
 */
export async function deletePhotoSafely(userId: number, fileId: string): Promise<number> {
  return withTx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [userId]);

    const wasMain = await client.query<{ is_main: boolean }>(
      "SELECT is_main FROM photos WHERE user_id=$1 AND file_id=$2",
      [userId, fileId]
    );

    const del = await client.query(
      "DELETE FROM photos WHERE user_id=$1 AND file_id=$2",
      [userId, fileId]
    );
    if (del.rowCount === 0) {
      throw new Error("PHOTO_NOT_FOUND");
    }

    if (wasMain.rows[0]?.is_main) {
      // назначим новое главное
      await client.query(
        `
        WITH first AS (
          SELECT id FROM photos
          WHERE user_id=$1
          ORDER BY pos ASC, id ASC
          LIMIT 1
        )
        UPDATE photos
        SET is_main=true
        WHERE id IN (SELECT id FROM first)
        `,
        [userId]
      );
    }

    const cnt = await client.query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1",
      [userId]
    );
    return cnt.rows[0]?.c ?? 0;
  });
}

/**
 * Переупорядочить фото: pos = 1..N в указанном порядке file_id[].
 * Любые отсутствующие файлы пропускаем; неуказанные — докидываем в хвост по старому порядку.
 */
export async function reorderPhotos(userId: number, orderedFileIds: string[]): Promise<void> {
  await withTx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [userId]);

    // текущие фотки
    const r = await client.query<{ id: number; file_id: string }>(
      "SELECT id, file_id FROM photos WHERE user_id=$1 ORDER BY pos ASC, id ASC",
      [userId]
    );
    const curr = r.rows;

    // карта: file_id -> id
    const byFile = new Map(curr.map(x => [x.file_id, x.id]));

    // новый порядок (только существующие)
    const normalized: number[] = [];
    for (const f of orderedFileIds) {
      const id = byFile.get(f);
      if (id) normalized.push(id);
    }
    // добавим те, что не вошли
    for (const x of curr) {
      if (!normalized.includes(x.id)) normalized.push(x.id);
    }

    // перенумеровка
    let pos = 1;
    for (const id of normalized) {
      await client.query("UPDATE photos SET pos=$2 WHERE id=$1", [id, pos++]);
    }
  });
}
