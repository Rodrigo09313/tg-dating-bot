// src/bot/reports.ts
// Система жалоб и модерации

import TelegramBot from "node-telegram-bot-api";
import { query } from "../db";
import { DbUser, sendScreen } from "./helpers";
import { logger } from "../lib/logger";
import { ErrorHandler } from "../lib/errorHandler";

export async function reportUser(
  bot: TelegramBot, 
  chatId: number, 
  user: DbUser, 
  targetId: number, 
  context: 'browse' | 'request'
) {
  try {
    logger.userAction('report_user', chatId, chatId, { targetId, context });
    
    // Проверяем, что пользователь существует
    const targetUser = await query<{ tg_id: number }>(
      "SELECT tg_id FROM users WHERE tg_id = $1",
      [targetId]
    );
    
    if (targetUser.rows.length === 0) {
      await sendScreen(bot, chatId, user, { text: "Пользователь не найден." });
      return;
    }

    // Проверяем, не жаловался ли уже
    const existingReport = await query<{ id: number }>(
      "SELECT id FROM reports WHERE reporter_id = $1 AND target_id = $2 AND context = $3",
      [chatId, targetId, context]
    );
    
    if (existingReport.rows.length > 0) {
      await sendScreen(bot, chatId, user, { text: "Вы уже жаловались на этого пользователя." });
      return;
    }

    // Создаем жалобу
    await query(`
      INSERT INTO reports (reporter_id, target_id, reason, context, created_at)
      VALUES ($1, $2, 'user_report', $3, now())
    `, [chatId, targetId, context]);

    await sendScreen(bot, chatId, user, { text: "✅ Жалоба отправлена. Спасибо за обратную связь!" });
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'report_user');
    await sendScreen(bot, chatId, user, { text: "Не удалось отправить жалобу. Попробуйте позже." });
  }
}
