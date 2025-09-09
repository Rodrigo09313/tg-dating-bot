// src/bot/browse.ts
// Показ следующей анкеты по правилам: совместимость, город/радиус, исключить уже показанных.
// Показываем главное фото, подпись с расстоянием (если есть), кнопки — из kb.browseCard.

import TelegramBot from "node-telegram-bot-api";
import { query } from "../db";
import { DbUser, sendScreen, setState } from "./helpers";
import { kb } from "../ui/buttons";

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
function buildCardCaption(c: CandidateRow): string {
  const parts: string[] = [];
  const header = `${c.name ?? "Без имени"}${c.age ? ", " + c.age : ""}${c.city_name ? ", " + c.city_name : ""}`;
  parts.push(`<b>${header}</b>`);
  if (c.about) parts.push(c.about.slice(0, 300));

  if (typeof c.dist_km === "number") {
    const km = Math.max(0, Math.round(c.dist_km * 10) / 10); // 1 знак после запятой
    parts.push(`📍 Находится в ~${km} км от вас`);
  }
  return parts.join("\n");
}

// Показать следующую карточку (или сообщение "никого рядом")
export async function browseShowNext(bot: TelegramBot, chatId: number, user: DbUser) {
  // переводим в состояние browse/browse_card
  await setState(chatId, "browse_card");

  const cand = await pickCandidate(chatId, DEFAULT_RADIUS_KM);
  if (!cand) {
    await sendScreen(bot, chatId, user, {
      text: [
        "Пока анкет поблизости не нашлось.",
        "Попробуй позже или расширь радиус (по умолчанию " + DEFAULT_RADIUS_KM + " км)."
      ].join("\n"),
      keyboard: [
        [{ text: "🔄 Ещё раз", callback_data: "brw:next" }],
        [{ text: "🏠 В меню",  callback_data: "sys:menu" }],
      ]
    });
    return;
  }

  // помечаем как просмотренного
  await query(
    `INSERT INTO browse_seen (user_id, seen_user_id, ts)
     VALUES ($1, $2, now())
     ON CONFLICT DO NOTHING`,
    [chatId, cand.tg_id]
  );

  // показываем карточку
  const caption = buildCardCaption(cand);
  await sendScreen(bot, chatId, user, {
    photoFileId: cand.file_id || undefined,
    text: cand.file_id ? undefined : caption, // если фото нет (не должно), уйдём текстом
    caption: cand.file_id ? caption : undefined,
    keyboard: kb.browseCard(cand.tg_id),
  });
}
