// src/bot/contacts.ts
// Управление запросами на контакты

import { Telegraf, Context } from 'telegraf';
import { query } from "../db";
import { DbUser, sendScreen } from "./helpers";
import { Keyboards } from "../ui/keyboards";
import { logger } from "../lib/logger";
import { ErrorHandler } from "../lib/errorHandler";
import { mkCb } from "../ui/cb";
import { CB } from "../types";

export async function showContactRequestsList(bot: Telegraf<Context>, chatId: number, user: DbUser) {
  try {
    logger.userAction('show_contact_requests_list', chatId, chatId);
    
    // Получаем входящие запросы
    const incoming = await query<{
      id: number;
      from_id: number;
      name: string | null;
      age: number | null;
      city_name: string | null;
      about: string | null;
      file_id: string | null;
      created_at: string;
    }>(`
      SELECT cr.id, cr.from_id, u.name, u.age, u.city_name, u.about,
             (SELECT p.file_id FROM photos p 
              WHERE p.user_id = u.tg_id 
              ORDER BY p.is_main DESC, p.pos ASC LIMIT 1) as file_id,
             cr.created_at
      FROM contact_requests cr
      JOIN users u ON u.tg_id = cr.from_id
      WHERE cr.to_id = $1 AND cr.status = 'pending'
      ORDER BY cr.created_at DESC
      LIMIT 10
    `, [chatId]);

    if (incoming.rows.length === 0) {
      await sendScreen(bot, chatId, user, {
        text: "У вас нет новых запросов на контакты.\n\nПросматривайте анкеты и отправляйте запросы!",
        keyboard: [
          [{ text: "💞 Найти пару", callback_data: mkCb(CB.BRW, "start") }],
          [{ text: "🏠 В меню", callback_data: mkCb(CB.SYS, "menu") }]
        ]
      });
      return;
    }

    // Показываем первый запрос
    const first = incoming.rows[0];
    const caption = buildUserCaption(first);
    
    await sendScreen(bot, chatId, user, {
      photoFileId: first.file_id || undefined,
      text: first.file_id ? undefined : caption,
      caption: first.file_id ? caption : undefined,
      keyboard: Keyboards.requestIncoming(first.id)
    });

  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'show_contact_requests_list');
    await sendScreen(bot, chatId, user, {
      text: "Не удалось загрузить запросы. Попробуйте позже.",
      keyboard: [
        [{ text: "🏠 В меню", callback_data: mkCb(CB.SYS, "menu") }]
      ]
    });
  }
}

export async function sendContactRequest(bot: Telegraf<Context>, chatId: number, user: DbUser, targetId: number) {
  try {
    logger.userAction('send_contact_request', chatId, chatId, { targetId });
    
    // Проверяем, что пользователь существует и активен
    const targetUser = await query<{ tg_id: number }>(
      "SELECT tg_id FROM users WHERE tg_id = $1 AND status = 'active'",
      [targetId]
    );
    
    if (targetUser.rows.length === 0) {
      await sendScreen(bot, chatId, user, { text: "Пользователь не найден или неактивен." });
      return;
    }

    // Проверяем, нет ли уже запроса
    const existing = await query<{ id: number }>(
      "SELECT id FROM contact_requests WHERE from_id = $1 AND to_id = $2 AND status = 'pending'",
      [chatId, targetId]
    );
    
    if (existing.rows.length > 0) {
      await sendScreen(bot, chatId, user, { text: "Запрос уже отправлен. Ожидайте ответа." });
      return;
    }

    // Создаем запрос
    await query(`
      INSERT INTO contact_requests (from_id, to_id, context, status, created_at)
      VALUES ($1, $2, 'browse', 'pending', now())
    `, [chatId, targetId]);

    await sendScreen(bot, chatId, user, { text: "✅ Запрос на контакт отправлен!" });
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'send_contact_request');
    await sendScreen(bot, chatId, user, { text: "Не удалось отправить запрос. Попробуйте позже." });
  }
}

export async function acceptContactRequest(bot: Telegraf<Context>, chatId: number, user: DbUser, requestId: number) {
  try {
    logger.userAction('accept_contact_request', chatId, chatId, { requestId });
    
    // Получаем информацию о запросе
    const request = await query<{
      id: number;
      from_id: number;
      to_id: number;
    }>(`
      SELECT id, from_id, to_id 
      FROM contact_requests 
      WHERE id = $1 AND to_id = $2 AND status = 'pending'
    `, [requestId, chatId]);
    
    if (request.rows.length === 0) {
      await sendScreen(bot, chatId, user, { text: "Запрос не найден или уже обработан." });
      return;
    }

    const { from_id } = request.rows[0];

    // Обновляем статус запроса
    await query(`
      UPDATE contact_requests 
      SET status = 'accepted', decided_at = now() 
      WHERE id = $1
    `, [requestId]);

    // Создаем контакт
    await query(`
      INSERT INTO contacts (a_id, b_id, created_at)
      VALUES (LEAST($1, $2), GREATEST($1, $2), now())
      ON CONFLICT (a_id, b_id) DO NOTHING
    `, [chatId, from_id]);

    await sendScreen(bot, chatId, user, { text: "✅ Контакт принят! Теперь вы можете общаться." });
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'accept_contact_request');
    await sendScreen(bot, chatId, user, { text: "Не удалось принять запрос. Попробуйте позже." });
  }
}

export async function declineContactRequest(bot: Telegraf<Context>, chatId: number, user: DbUser, requestId: number) {
  try {
    logger.userAction('decline_contact_request', chatId, chatId, { requestId });
    
    // Обновляем статус запроса
    await query(`
      UPDATE contact_requests 
      SET status = 'declined', decided_at = now() 
      WHERE id = $1 AND to_id = $2
    `, [requestId, chatId]);

    await sendScreen(bot, chatId, user, { text: "❌ Запрос отклонен." });
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'decline_contact_request');
    await sendScreen(bot, chatId, user, { text: "Не удалось отклонить запрос. Попробуйте позже." });
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
  if (user.about) parts.push(user.about.slice(0, 300));
  return parts.join("\n");
}
