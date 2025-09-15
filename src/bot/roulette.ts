// src/bot/roulette.ts
// Чат-рулетка - анонимный чат с ближайшим пользователем

import TelegramBot from "node-telegram-bot-api";
import { query } from "../db";
import { DbUser, sendScreen, setState } from "./helpers";
import { Keyboards } from "../ui/keyboards";
import { logger } from "../lib/logger";
import { ErrorHandler } from "../lib/errorHandler";

export async function startRoulette(bot: TelegramBot, chatId: number, user: DbUser) {
  try {
    logger.userAction('start_roulette', chatId, chatId);
    
    // Проверяем, что пользователь активен
    if (user.status !== 'active') {
      await sendScreen(bot, chatId, user, { text: "Сначала завершите регистрацию." });
      return;
    }

    // Проверяем, не в очереди ли уже
    const inQueue = await query<{ user_id: number }>(
      "SELECT user_id FROM roulette_queue WHERE user_id = $1",
      [chatId]
    );
    
    if (inQueue.rows.length > 0) {
      await sendScreen(bot, chatId, user, { 
        text: "🎲 Вы уже в очереди рулетки. Ожидайте...\n\nИщем подходящего собеседника для анонимного чата.",
        keyboard: Keyboards.rouletteWaiting()
      });
      return;
    }

    // Добавляем в очередь
    await query(`
      INSERT INTO roulette_queue (user_id, joined_at, geom)
      VALUES ($1, now(), (SELECT geom FROM users WHERE tg_id = $1))
    `, [chatId]);

    await setState(chatId, 'roulette_waiting');
    
    await sendScreen(bot, chatId, user, {
      text: "🎲 Ищем собеседника...\n\nОжидайте, пока найдется подходящий человек для анонимного чата.",
      keyboard: Keyboards.rouletteWaiting()
    });

    // Пытаемся найти пару
    await tryMatchPair(bot, chatId, user);
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'start_roulette');
    await sendScreen(bot, chatId, user, { 
      text: "❌ Не удалось начать рулетку. Попробуйте позже.",
      keyboard: Keyboards.backToMenu()
    });
  }
}

export async function stopRoulette(bot: TelegramBot, chatId: number, user: DbUser) {
  try {
    logger.userAction('stop_roulette', chatId, chatId);
    
    // Удаляем из очереди
    await query("DELETE FROM roulette_queue WHERE user_id = $1", [chatId]);
    
    // Завершаем активную сессию, если есть
    await query(`
      UPDATE roulette_pairs 
      SET status = 'ended', ended_at = now() 
      WHERE (u1 = $1 OR u2 = $1) AND status = 'active'
    `, [chatId]);

    await setState(chatId, 'idle');
    
    // Возвращаем в главное меню
    const { showMainMenu } = await import("./menu");
    await showMainMenu(bot, chatId, user);
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'stop_roulette');
    await sendScreen(bot, chatId, user, { 
      text: "❌ Не удалось отменить поиск. Попробуйте позже.",
      keyboard: Keyboards.backToMenu()
    });
  }
}

async function tryMatchPair(bot: TelegramBot, chatId: number, user: DbUser) {
  try {
    // Ищем подходящего собеседника
    const match = await query<{
      user_id: number;
      name: string | null;
      age: number | null;
      city_name: string | null;
    }>(`
      SELECT rq.user_id, u.name, u.age, u.city_name
      FROM roulette_queue rq
      JOIN users u ON u.tg_id = rq.user_id
      WHERE rq.user_id != $1 
        AND u.status = 'active'
        AND rq.locked_by IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM roulette_pairs rp 
          WHERE (rp.u1 = $1 AND rp.u2 = rq.user_id) 
             OR (rp.u2 = $1 AND rp.u1 = rq.user_id)
          AND rp.status = 'active'
        )
      ORDER BY RANDOM()
      LIMIT 1
    `, [chatId]);

    if (match.rows.length === 0) {
      // Никого не найдено, продолжаем ждать
      setTimeout(() => tryMatchPair(bot, chatId, user), 5000);
      return;
    }

    const partner = match.rows[0];
    
    // Блокируем обоих пользователей
    await query(`
      UPDATE roulette_queue 
      SET locked_by = $1, locked_at = now() 
      WHERE user_id = $2
    `, [chatId, partner.user_id]);

    await query(`
      UPDATE roulette_queue 
      SET locked_by = $1, locked_at = now() 
      WHERE user_id = $1
    `, [chatId]);

    // Создаем пару
    await query(`
      INSERT INTO roulette_pairs (u1, u2, status, started_at)
      VALUES (LEAST($1, $2), GREATEST($1, $2), 'active', now())
    `, [chatId, partner.user_id]);

    // Удаляем из очереди
    await query("DELETE FROM roulette_queue WHERE user_id IN ($1, $2)", [chatId, partner.user_id]);

    // Уведомляем обоих пользователей
    const partnerInfo = `${partner.name || "Аноним"}${partner.age ? ", " + partner.age : ""}${partner.city_name ? ", " + partner.city_name : ""}`;
    
    await sendScreen(bot, chatId, user, {
      text: `🎉 Найден собеседник!\n\n${partnerInfo}\n\nЧат начался. Напишите сообщение для общения.`,
      keyboard: Keyboards.rouletteChat()
    });

    await sendScreen(bot, partner.user_id, { 
      tg_id: partner.user_id, 
      username: null, 
      name: user.name, 
      state: null, 
      status: 'active' as const, 
      last_screen_msg_id: null, 
      last_screen_at: null 
    } as DbUser, {
      text: `🎉 Найден собеседник!\n\n${user.name || "Аноним"}\n\nЧат начался. Напишите сообщение для общения.`,
      keyboard: Keyboards.rouletteChat()
    });

    await setState(chatId, 'roulette_chat');
    await setState(partner.user_id, 'roulette_chat');
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'try_match_pair');
  }
}
