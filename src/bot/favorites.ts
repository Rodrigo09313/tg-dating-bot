import { esc } from "../lib/html";
// src/bot/favorites.ts
// Управление избранными пользователями

import TelegramBot from "node-telegram-bot-api";
import { query } from "../db";
import { DbUser, sendScreen } from "./helpers";
import { Keyboards } from "../ui/keyboards";
import { logger } from "../lib/logger";
import { ErrorHandler } from "../lib/errorHandler";
import { mkCb } from "../ui/cb";
import { CB } from "../types";

export async function showFavoritesList(bot: TelegramBot, chatId: number, user: DbUser) {
  try {
    logger.userAction('show_favorites_list', chatId, chatId);
    
    const favorites = await query<{
      tg_id: number;
      name: string | null;
      age: number | null;
      city_name: string | null;
      about: string | null;
      file_id: string | null;
    }>(`
      SELECT u.tg_id, u.name, u.age, u.city_name, u.about,
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
      LIMIT 20
    `, [chatId]);

    if (favorites.rows.length === 0) {
      await sendScreen(bot, chatId, user, {
        text: "У вас пока нет избранных контактов.\n\nНачните знакомства, чтобы найти интересных людей!",
        keyboard: Keyboards.favoritesList()
      });
      return;
    }

    // Показываем первого из списка
    const first = favorites.rows[0];
    const caption = buildUserCaption(first);
    
    await sendScreen(bot, chatId, user, {
      photoFileId: first.file_id || undefined,
      text: first.file_id ? undefined : caption,
      caption: first.file_id ? caption : undefined,
      keyboard: [
        [{ text: "💞 Найти ещё", callback_data: mkCb(CB.BRW, "start") }],
        [{ text: "🏠 В меню", callback_data: mkCb(CB.SYS, "menu") }]
      ]
    });

  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'show_favorites_list');
    await sendScreen(bot, chatId, user, {
      text: "Не удалось загрузить список избранных. Попробуйте позже.",
      keyboard: Keyboards.favoritesList()
    });
  }
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
      await sendScreen(bot, chatId, user, { text: "Пользователь не найден или неактивен." });
      return;
    }

    // Добавляем в избранное (создаем контакт)
    await query(`
      INSERT INTO contacts (a_id, b_id, created_at)
      VALUES (LEAST($1, $2), GREATEST($1, $2), now())
      ON CONFLICT (a_id, b_id) DO NOTHING
    `, [chatId, targetId]);

    await sendScreen(bot, chatId, user, { text: "✅ Добавлено в избранное!" });
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'add_to_favorites');
    await sendScreen(bot, chatId, user, { text: "Не удалось добавить в избранное. Попробуйте позже." });
  }
}

export async function removeFromFavorites(bot: TelegramBot, chatId: number, user: DbUser, targetId: number) {
  try {
    logger.userAction('remove_from_favorites', chatId, chatId, { targetId });
    
    await query(`
      DELETE FROM contacts 
      WHERE (a_id = $1 AND b_id = $2) OR (a_id = $2 AND b_id = $1)
    `, [chatId, targetId]);

    await sendScreen(bot, chatId, user, { text: "❌ Удалено из избранного." });
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'remove_from_favorites');
    await sendScreen(bot, chatId, user, { text: "Не удалось удалить из избранного. Попробуйте позже." });
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
