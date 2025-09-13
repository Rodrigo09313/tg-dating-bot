// src/bot/browse.ts
// Показ следующей анкеты по правилам: совместимость, город/радиус, исключить уже показанных.
// Показываем главное фото, подпись с расстоянием (если есть), кнопки — из kb.browseCard.

import TelegramBot from "node-telegram-bot-api";
import { query } from "../db";
import { DbUser, sendScreen, setState } from "./helpers";
import { Keyboards } from "../ui/keyboards";
import { logger } from "../lib/logger";
import { ErrorHandler } from "../lib/errorHandler";
import { TXT } from "../ui/text";
import { mkCb } from "../ui/cb";
import { CB } from "../types";

// Конфиг по умолчанию
const DEFAULT_RADIUS_KM = Number(process.env.BROWSE_RADIUS_KM ?? 50); // радиус отбора при наличии гео

type CandidateRow = {
  tg_id: number;
  name: string | null;
  age: number | null;
  city_name: string | null;
  about: string | null;
  file_id: string | null;   // главное фото
  dist_km: number | null;   // расстояние до текущего пользователя
};

// Собираем пул кандидатов с учётом совместимости и гео, исключая уже просмотренных
async function pickCandidate(currentId: number, radiusKm: number): Promise<CandidateRow | null> {
  // Берём пользователя для параметров
  const meQ = await query<{
    gender: "m" | "f" | null,
    seek: "m" | "f" | "b" | null,
    city_name: string | null,
    has_geom: boolean,
  }>(`
    SELECT gender, seek, city_name, geom IS NOT NULL AS has_geom
    FROM users WHERE tg_id = $1
  `, [currentId]);
  const me = meQ.rows[0];
  if (!me) return null;

  const wantM = me.seek === "m" || me.seek === "b";
  const wantF = me.seek === "f" || me.seek === "b";
  const myIsM = me.gender === "m";
  const myIsF = me.gender === "f";

  // SQL:
  //  - активные + не я
  //  - у кандидата есть хотя бы одно фото
  //  - взаимная совместимость по полу/поиску
  //  - геофильтр:
  //      (оба с geom -> в радиусе) OR (оба с city_name и одинаковые города)
  //  - исключаем уже показанных в browse_seen
  //  - берём случайные из пула до 50, затем 1
  const sql = `
    WITH me AS (
      SELECT tg_id, geom, city_name
      FROM users WHERE tg_id = $1
    ),
    base AS (
      SELECT u.tg_id, u.name, u.age, u.city_name, u.about,
             -- главное фото: is_main или pos=1
             (SELECT p.file_id
              FROM photos p
              WHERE p.user_id = u.tg_id
              ORDER BY p.is_main DESC, p.pos ASC
              LIMIT 1) AS file_id,
             -- расстояние в км (если обе геоточки есть)
             CASE
               WHEN u.geom IS NOT NULL AND (SELECT geom FROM me) IS NOT NULL
                 THEN ST_DistanceSphere(u.geom, (SELECT geom FROM me)) / 1000.0
               ELSE NULL
             END AS dist_km
      FROM users u
      WHERE u.status = 'active'
        AND u.tg_id <> $1
        AND EXISTS (SELECT 1 FROM photos px WHERE px.user_id = u.tg_id)
        -- совместимость: я хочу его пол, а он хочет мой пол (или 'b')
        AND (
              ($2::bool = TRUE AND u.gender = 'm') OR
              ($3::bool = TRUE AND u.gender = 'f')
            )
        AND (
              (u.seek = 'b') OR
              (u.seek = 'm' AND $4::bool = TRUE) OR
              (u.seek = 'f' AND $5::bool = TRUE)
            )
        -- не показывать ранее показанных
        AND NOT EXISTS (
          SELECT 1 FROM browse_seen bs
          WHERE bs.user_id = $1 AND bs.seen_user_id = u.tg_id
        )
        -- геофильтр
        AND (
          -- оба с гео -> по радиусу
          (u.geom IS NOT NULL AND (SELECT has_geom FROM (SELECT geom IS NOT NULL AS has_geom FROM users WHERE tg_id=$1) x) = TRUE
             AND ST_DWithin(u.geom::geography, (SELECT geom FROM me)::geography, $6 * 1000)
          )
          OR
          -- оба с городом и совпадает city_name
          (u.city_name IS NOT NULL AND (SELECT city_name FROM me) IS NOT NULL
             AND lower(u.city_name) = lower((SELECT city_name FROM me))
          )
        )
    )
    SELECT * FROM base
    ORDER BY random()
    LIMIT 1;
  `;

  const r = await query<CandidateRow>(sql, [
    currentId,
    wantM,          // $2
    wantF,          // $3
    myIsM,          // $4
    myIsF,          // $5
    radiusKm,       // $6
  ]);

  return r.rows[0] ?? null;
}

// Сформировать подпись карточки
export function buildCardCaption(c: CandidateRow): string {
  const parts: string[] = [];
  const header = `${c.name ?? TXT.browse.noName}${c.age ? ", " + c.age : ""}${c.city_name ? ", " + c.city_name : ""}`;
  parts.push(`<b>${header}</b>`);
  if (c.about) parts.push(c.about.slice(0, 300));

  if (typeof c.dist_km === "number") {
    const km = Math.max(0, Math.round(c.dist_km * 10) / 10); // 1 знак после запятой
    parts.push(`📍 Находится в ~${km} км от вас`);
  }
  return parts.join("\n");
}

// Получить все фото кандидата
export async function getCandidatePhotos(candidateId: number): Promise<string[]> {
  const r = await query<{ file_id: string }>(
    `SELECT file_id
     FROM photos
     WHERE user_id = $1
     ORDER BY is_main DESC, pos ASC, id ASC
     LIMIT 5`, [candidateId]
  );
  return r.rows.map((x: { file_id: string }) => x.file_id);
}

// Показать следующую карточку (или сообщение "никого рядом")
export async function browseShowNext(bot: TelegramBot, chatId: number, user: DbUser) {
  // переводим в состояние browse/browse_card
  await setState(chatId, "browse_card");

  const cand = await pickCandidate(chatId, DEFAULT_RADIUS_KM);
  if (!cand) {
    // Если нет кандидатов, сбрасываем просмотренные и ищем снова
    await query("DELETE FROM browse_seen WHERE user_id = $1", [chatId]);
    
    // Пытаемся найти кандидата снова
    const newCand = await pickCandidate(chatId, DEFAULT_RADIUS_KM);
    if (!newCand) {
      // Если и после сброса никого нет - показываем сообщение
      await sendScreen(bot, chatId, user, {
        text: [
          TXT.browse.noResults,
          TXT.browse.tryLater.replace('{radius}', DEFAULT_RADIUS_KM.toString())
        ].join("\n"),
        keyboard: [
          [{ text: TXT.browse.tryAgain, callback_data: mkCb(CB.BRW, "next") }],
          [{ text: TXT.browse.backToMenu, callback_data: mkCb(CB.SYS, "menu") }],
        ]
      });
      return;
    }
    
    // Используем найденного кандидата
    const finalCand = newCand;
    // Помечаем как просмотренного
    await query(
      `INSERT INTO browse_seen (user_id, seen_user_id, ts)
       VALUES ($1, $2, now())
       ON CONFLICT DO NOTHING`,
      [chatId, finalCand.tg_id]
    );

    // Показываем карточку с каруселью фото
    await showBrowseCard(bot, chatId, user, finalCand);
    return;
  }

  // помечаем как просмотренного
  await query(
    `INSERT INTO browse_seen (user_id, seen_user_id, ts)
     VALUES ($1, $2, now())
     ON CONFLICT DO NOTHING`,
    [chatId, cand.tg_id]
  );

  // показываем карточку с каруселью фото
  await showBrowseCard(bot, chatId, user, cand);
}

// Показать карточку кандидата с каруселью фото
async function showBrowseCard(bot: TelegramBot, chatId: number, user: DbUser, candidate: CandidateRow) {
  const photos = await getCandidatePhotos(candidate.tg_id);
  const caption = buildCardCaption(candidate);

  if (photos.length > 0) {
    const currentIndex = 0;
    await sendScreen(bot, chatId, user, {
      photoFileId: photos[currentIndex],
      caption,
      keyboard: Keyboards.browseCardWithNav(candidate.tg_id, photos.length, currentIndex),
    });
  } else {
    await sendScreen(bot, chatId, user, { 
      text: caption, 
      keyboard: Keyboards.browseCard(candidate.tg_id) 
    });
  }
}

// Получить ID текущего кандидата для навигации по фото
export async function getCurrentBrowseCandidate(chatId: number): Promise<number | null> {
  try {
    const result = await query<{ seen_user_id: number }>(
      `SELECT seen_user_id 
       FROM browse_seen 
       WHERE user_id = $1 
       ORDER BY ts DESC 
       LIMIT 1`,
      [chatId]
    );
    return result.rows[0]?.seen_user_id || null;
  } catch (error) {
    logger.error("Failed to get current browse candidate", {
      action: 'get_current_browse_candidate',
      chatId,
      error: error as Error
    });
    return null;
  }
}

