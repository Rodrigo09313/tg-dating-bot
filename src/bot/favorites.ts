import { esc } from "../lib/html.js";
// src/bot/favorites.ts
// Управление избранными пользователями

import TelegramBot from "node-telegram-bot-api";
import { query } from "../db.js";
import { DbUser, sendScreen } from "./helpers.js";
import { Keyboards } from "../ui/keyboards.js";
import { logger } from "../lib/logger.js";
import { ErrorHandler } from "../lib/errorHandler.js";
import { mkCb } from "../ui/cb.js";
import { CB } from "../types.js";

export async function showFavoritesList(bot: TelegramBot, chatId: number, user: DbUser) {
  try {
    logger.userAction('show_favorites_list', { chatId });
    await showFavoritesCard(bot, chatId, user, 0);
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'show_favorites_list');
    await sendScreen(bot, chatId, user, {
      text: "Не удалось загрузить список избранных. Попробуйте позже.",
      keyboard: Keyboards.backToMenu()
    });
  }
}

export async function showFavoritesCard(bot: TelegramBot, chatId: number, user: DbUser, index: number = 0) {
  // Получаем избранных пользователей (контакты)
  const favorites = await query<{
    tg_id: number;
    name: string | null;
    age: number | null;
    city_name: string | null;
    about: string | null;
    file_id: string | null;
  }>(
    `SELECT u.tg_id, u.name, u.age, u.city_name, u.about,
            (SELECT p.file_id FROM photos p 
             WHERE p.user_id = u.tg_id 
             ORDER BY p.is_main DESC, p.pos ASC LIMIT 1) as file_id
     FROM users u
     INNER JOIN contacts c ON (
       (c.a_id = $1 AND c.b_id = u.tg_id) OR 
       (c.b_id = $1 AND c.a_id = u.tg_id)
     )
     WHERE u.status = 'active' AND u.tg_id != $1
     ORDER BY c.created_at DESC
     LIMIT 50`,
    [chatId]
  );

  if (favorites.rows.length === 0) {
    await sendScreen(bot, chatId, user, {
      text: "У вас пока нет избранных контактов.",
      keyboard: [
        [{ text: "◀️ Назад", callback_data: mkCb(CB.PRF, "open") }]
      ]
    });
    return;
  }

  const safeIndex = Number.isFinite(index) && index >= 0 ? index : 0;
  const i = safeIndex % favorites.rows.length;
  const row = favorites.rows[i];
  const caption = buildUserCaption(row);

  await sendScreen(bot, chatId, user, {
    photoFileId: row.file_id || undefined,
    text: row.file_id ? undefined : caption,
    caption: row.file_id ? caption : undefined,
    keyboard: [
      [
        { text: "💌 Написать",   callback_data: mkCb(CB.CR, "req", row.tg_id) },
        { text: "💞 Следующий",  callback_data: mkCb(CB.FAV, "next", i + 1) }
      ],
      [ { text: "◀️ Назад", callback_data: mkCb(CB.PRF, "open") } ]
    ]
  });
}

export async function addToFavorites(bot: TelegramBot, chatId: number, user: DbUser, targetId: number) {
  try {
    logger.userAction('add_to_favorites', chatId, chatId, { targetId });
    
    // Проверяем, что пользователь существует и активен
    const targetUser = await query<{ tg_id: number }>(
      "SELECT tg_id FROM users WHERE tg_id = $1 AND status = 'active'",
      [targetId]
    );
    
    if (targetUser.rows.length === 0) {
      // Тихое завершение: пользователь пропал/неактивен — сообщим во всплывашке из хэндлера
      return;
    }

    // Добавляем в избранное (создаём контакт), без ON CONFLICT
    await query(`
      WITH norm AS (
        SELECT LEAST($1::bigint, $2::bigint) AS a, GREATEST($1::bigint, $2::bigint) AS b
      )
      INSERT INTO contacts (a_id, b_id, created_at)
      SELECT a, b, now()
      FROM norm
      WHERE NOT EXISTS (
        SELECT 1 FROM contacts c WHERE (c.a_id = (SELECT a FROM norm) AND c.b_id = (SELECT b FROM norm))
      );
    `, [chatId, targetId]);

    // Тихий режим: не меняем текущий экран
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'add_to_favorites');
    // Ошибка — оставляем экран, всплывашку отдаёт хэндлер при необходимости
  }
}

export async function removeFromFavorites(bot: TelegramBot, chatId: number, user: DbUser, targetId: number) {
  try {
    logger.userAction('remove_from_favorites', chatId, chatId, { targetId });
    
    await query(`
      DELETE FROM contacts 
      WHERE (a_id = $1 AND b_id = $2) OR (a_id = $2 AND b_id = $1)
    `, [chatId, targetId]);
    // Тихий режим: не меняем текущий экран
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'remove_from_favorites');
    // Ошибка — оставляем экран, всплывашку отдаёт хэндлер при необходимости
  }
}

function buildUserCaption(user: {
  name: string | null;
  age: number | null;
  city_name: string | null;
  about: string | null;
}): string {
  const parts: string[] = [];
  const header = `${user.name ?? "Без имени"}${user.age ? ", " + user.age : ""}${user.city_name ? ", " + user.city_name : ""}`;
  parts.push(`<b>${header}</b>`);
  if (user.about) parts.push(esc(user.about).slice(0, 300));
  return parts.join("\n");
}
