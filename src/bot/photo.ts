// src/bot/photo.ts
// Безопасная работа с фото: транзакция + advisory lock на user_id (BIGINT).
// Фикс: используем одноаргументный pg_advisory_xact_lock(bigint), а не (int,int).

import TelegramBot, { PhotoSize } from "node-telegram-bot-api";
import { query, withTx } from "../db";

// Берём самый крупный вариант из набора
function pickLargestPhoto(variants: PhotoSize[]): PhotoSize {
  return variants.slice().sort((a, b) => {
    const areaA = (a.width || 0) * (a.height || 0);
    const areaB = (b.width || 0) * (b.height || 0);
    if (areaA !== areaB) return areaB - areaA;
    return (b.file_size || 0) - (a.file_size || 0);
  })[0];
}

/**
 * Атомарно добавляет фото пользователю.
 * Лочим по user_id через pg_advisory_xact_lock(bigint) — никаких переполнений int4.
 */
export async function addPhotoSafely(
  userId: number,
  fileId: string
): Promise<{ position: number; total: number; madeMain: boolean }> {
  return withTx(async (client) => {
    // ВАЖНО: one-arg BIGINT
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [String(userId)]);
    await client.query("SELECT id FROM photos WHERE user_id=$1 FOR UPDATE", [userId]);

    const cntRes = await client.query<{ c: number }>("SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1", [userId]);
    const count = cntRes.rows[0]?.c ?? 0;
    if (count >= 3) throw new Error("LIMIT_REACHED");

    const maxRes = await client.query<{ m: number }>("SELECT COALESCE(MAX(pos),0) AS m FROM photos WHERE user_id=$1", [userId]);
    const nextPos = (maxRes.rows[0]?.m ?? 0) + 1;

    const mainRes = await client.query<{ id: number }>("SELECT id FROM photos WHERE user_id=$1 AND is_main=true LIMIT 1", [userId]);
    const makeMain = mainRes.rowCount === 0;

    await client.query(
      "INSERT INTO photos(user_id, file_id, pos, is_main) VALUES ($1,$2,$3,$4)",
      [userId, fileId, nextPos, makeMain]
    );

    return { position: nextPos, total: count + 1, madeMain: makeMain };
  });
}


/**
 * Импорт фото из профиля Telegram (до 3 шт), с опцией replace.
 * Также под BIGINT-локом.
 */
export async function importPhotosFromTelegramProfile(
  bot: TelegramBot,
  userId: number,
  opts: { replace?: boolean; limit?: number } = {}
): Promise<number> {
  const limit = Math.max(1, Math.min(5, opts.limit ?? 5));
  const prof = await bot.getUserProfilePhotos(userId, { limit: 100 });
  const groups = prof.photos || [];
  if (!groups.length) return 0;

  return withTx(async (client) => {
    // ВАЖНО: one-arg BIGINT
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [String(userId)]);
    await client.query("SELECT id FROM photos WHERE user_id=$1 FOR UPDATE", [userId]);

    if (opts.replace) {
      await client.query("DELETE FROM photos WHERE user_id=$1", [userId]);
    }

    let cntRes = await client.query<{ c: number }>("SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1", [userId]);
    let count = cntRes.rows[0]?.c ?? 0;

    let inserted = 0;
    for (const group of groups) {
      if (inserted >= limit || count >= 5) break;

      const best = pickLargestPhoto(group);
      const exists = await client.query(
        "SELECT 1 FROM photos WHERE user_id=$1 AND file_id=$2 LIMIT 1",
        [userId, best.file_id]
      );
      if (exists.rowCount) continue;

      const maxRes = await client.query<{ m: number }>("SELECT COALESCE(MAX(pos),0) AS m FROM photos WHERE user_id=$1", [userId]);
      const nextPos = (maxRes.rows[0]?.m ?? 0) + 1;

      const mainRes = await client.query<{ id: number }>("SELECT id FROM photos WHERE user_id=$1 AND is_main=true LIMIT 1", [userId]);
      const makeMain = mainRes.rowCount === 0;

      await client.query(
        "INSERT INTO photos(user_id, file_id, pos, is_main) VALUES ($1,$2,$3,$4)",
        [userId, best.file_id, nextPos, makeMain]
      );

      inserted++;
      count++;
    }

    // Если нет main — назначим самое раннее
    const chk = await client.query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1 AND is_main=true",
      [userId]
    );
    if ((chk.rows[0]?.c ?? 0) === 0) {
      await client.query(`
        WITH first AS (SELECT id FROM photos WHERE user_id=$1 ORDER BY pos ASC, id ASC LIMIT 1)
        UPDATE photos SET is_main=true WHERE id IN (SELECT id FROM first)
      `, [userId]);
    }

    return inserted;
  });
}

/**
 * Получить все фото пользователя для карусели
 */
export async function getAllUserPhotos(userId: number): Promise<string[]> {
  const r = await query<{ file_id: string }>(
    `SELECT file_id
     FROM photos
     WHERE user_id = $1
     ORDER BY is_main DESC, pos ASC, id ASC`,
    [userId]
  );
  return r.rows.map((x: { file_id: string }) => x.file_id);
}

/**
 * Получить фото из профиля Telegram для предпросмотра (без импорта в базу)
 */
export async function getTelegramProfilePhotosForPreview(
  bot: TelegramBot,
  userId: number,
  limit: number = 5
): Promise<string[]> {
  try {
    const prof = await bot.getUserProfilePhotos(userId, { limit: 100 });
    const groups = prof.photos || [];
    if (!groups.length) return [];

    const photos: string[] = [];
    for (const group of groups) {
      if (photos.length >= limit) break;
      const best = pickLargestPhoto(group);
      photos.push(best.file_id);
    }
    return photos;
  } catch (error) {
    return [];
  }
}

/**
 * Валидация загруженного фото
 */
export function validatePhoto(photo: PhotoSize): { valid: boolean; error?: string } {
  // Проверяем размер файла (максимум 5MB)
  const maxSize = 5 * 1024 * 1024; // 5MB в байтах
  if (photo.file_size && photo.file_size > maxSize) {
    return { valid: false, error: "Размер фото слишком большой. Максимум 5MB." };
  }

  // Проверяем размеры изображения
  if (photo.width && photo.height) {
    const minSize = 100; // Минимальный размер
    const maxSize = 4096; // Максимальный размер
    if (photo.width < minSize || photo.height < minSize) {
      return { valid: false, error: "Фото слишком маленькое. Минимум 100x100 пикселей." };
    }
    if (photo.width > maxSize || photo.height > maxSize) {
      return { valid: false, error: "Фото слишком большое. Максимум 4096x4096 пикселей." };
    }
  }

  return { valid: true };
}

/**
 * Получить лучший размер фото из массива
 */
export function getBestPhotoSize(photos: PhotoSize[]): PhotoSize | null {
  if (!photos || photos.length === 0) return null;
  
  // Сортируем по качеству: сначала по площади, потом по размеру файла
  const sorted = photos.slice().sort((a, b) => {
    const areaA = (a.width || 0) * (a.height || 0);
    const areaB = (b.width || 0) * (b.height || 0);
    if (areaA !== areaB) return areaB - areaA;
    return (b.file_size || 0) - (a.file_size || 0);
  });
  
  return sorted[0];
}
