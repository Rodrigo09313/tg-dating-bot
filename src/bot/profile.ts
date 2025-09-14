// src/bot/profile.ts
// Экран "Профиль" с каруселью фото: одно сообщение, фото переключаются через editMessageMedia.
import { Telegraf, Context } from 'telegraf';
import { query } from "../db";
import { DbUser, sendScreen } from "./helpers";
import { Keyboards } from "../ui/keyboards";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Все фото пользователя (до 3), в порядке pos ASC
export async function getAllPhotoIds(userId: number): Promise<string[]> {
  const r = await query<{ file_id: string }>(
    `SELECT file_id
     FROM photos
     WHERE user_id = $1
     ORDER BY is_main DESC, pos ASC, id ASC
     LIMIT 3`, [userId]
  );
  return r.rows.map((x: { file_id: string }) => x.file_id);
}

// Главное фото (с учётом is_main)
export async function getMainPhotoFileId(userId: number): Promise<string | null> {
  const r = await query<{ file_id: string }>(
    `SELECT file_id
     FROM photos
     WHERE user_id = $1
     ORDER BY is_main DESC, pos ASC, id ASC
     LIMIT 1`, [userId]
  );
  return r.rowCount ? r.rows[0].file_id : null;
}

// Подпись профиля "Имя, возраст, город\nО себе"
export async function buildProfileCaption(userId: number): Promise<string> {
  const r = await query<{ name: string|null; age: number|null; city_name: string|null; about: string|null }>(
    `SELECT name, age, city_name, about FROM users WHERE tg_id = $1`, [userId]
  );
  const u = r.rows[0] || {};
  const line1 = `${esc(u.name ?? "Без имени")}${u.age ? ", " + u.age : ""}${u.city_name ? ", " + esc(u.city_name) : ""}`;
  const line2 = u.about ? esc(u.about) : "";
  return [line1, line2].filter(Boolean).join("\n");
}

// Рендер профиля: если фото >1 — показываем карусель (клавиатура с навигацией)
export async function showProfile(bot: Telegraf<Context>, chatId: number, user: DbUser) {
  const photos = await getAllPhotoIds(chatId);
  const caption = await buildProfileCaption(chatId);

  if (photos.length > 0) {
    const currentIndex = 0;
    await sendScreen(bot, chatId, user, {
      photoFileId: photos[currentIndex],
      caption,
      keyboard: Keyboards.profileWithNav(photos.length, currentIndex),
    });
  } else {
    await sendScreen(bot, chatId, user, { text: caption, keyboard: Keyboards.profile() });
  }
}
