import { esc } from "../lib/html";
// src/bot/contacts.ts
// Управление запросами на контакты

import TelegramBot from "node-telegram-bot-api";
import { query } from "../db";
import { DbUser, sendScreen, ensureUser } from "./helpers";
import { showMainMenu } from "./menu";
import { Keyboards } from "../ui/keyboards";
import { logger } from "../lib/logger";
import { ErrorHandler } from "../lib/errorHandler";
import { mkCb } from "../ui/cb";
import { CB } from "../types";
import { browseShowNext } from "./browse";

export async function showContactRequestsList(bot: TelegramBot, chatId: number, user: DbUser) {
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
      keyboard: Keyboards.requestIncoming(first.id, first.from_id)
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

export async function showAcceptedContacts(bot: TelegramBot, chatId: number, user: DbUser) {
  try {
    logger.userAction('show_accepted_contacts', chatId, chatId);

    const accepted = await query<{
      tg_id: number;
      name: string | null;
      age: number | null;
      city_name: string | null;
      about: string | null;
      file_id: string | null;
      created_at: string;
    }>(`
      SELECT u.tg_id, u.name, u.age, u.city_name, u.about,
             (SELECT p.file_id FROM photos p 
              WHERE p.user_id = u.tg_id 
              ORDER BY p.is_main DESC, p.pos ASC LIMIT 1) as file_id,
             c.created_at
      FROM contacts c
      JOIN users u ON (u.tg_id = CASE WHEN c.a_id = $1 THEN c.b_id ELSE c.a_id END)
      WHERE c.a_id = $1 OR c.b_id = $1
      ORDER BY c.created_at DESC
      LIMIT 20
    `, [chatId]);

    if (accepted.rows.length === 0) {
      await sendScreen(bot, chatId, user, {
        text: "Пока нет принятых контактов.",
        keyboard: Keyboards.backToMenu()
      });
      return;
    }

    const first = accepted.rows[0];
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
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'show_accepted_contacts');
    await sendScreen(bot, chatId, user, { text: "Не удалось загрузить принятые контакты.", keyboard: Keyboards.backToMenu() });
  }
}

export async function sendContactRequest(bot: TelegramBot, chatId: number, user: DbUser, targetId: number) {
  try {
    logger.userAction('send_contact_request', chatId, chatId, { targetId });
    
    // Проверяем, что пользователь существует и активен
    const targetUser = await query<{ tg_id: number }>(
      "SELECT tg_id FROM users WHERE tg_id = $1 AND status = 'active'",
      [targetId]
    );
    
    if (targetUser.rows.length === 0) {
      await bot.sendMessage(chatId, "Пользователь не найден или неактивен.");
      return;
    }

    // Проверяем, нет ли уже запроса
    const existing = await query<{ id: number }>(
      "SELECT id FROM contact_requests WHERE from_id = $1 AND to_id = $2 AND status = 'pending'",
      [chatId, targetId]
    );
    
    if (existing.rows.length > 0) {
      await bot.sendMessage(chatId, "Запрос уже отправлен. Ожидайте ответа.");
      // Возвращаемся к просмотру анкет
      await browseShowNext(bot, chatId, user);
      return;
    }

    // Создаем запрос и получаем его id
    const created = await query<{ id: number }>(`
      INSERT INTO contact_requests (from_id, to_id, context, status, created_at)
      VALUES ($1, $2, 'browse', 'pending', now())
      RETURNING id
    `, [chatId, targetId]);
    const crId = created.rows[0].id;

    // Уведомляем получателя: показываем карточку отправителя с кнопками Принять/Отклонить
    const sender = await query<{
      name: string | null;
      age: number | null;
      city_name: string | null;
      about: string | null;
      file_id: string | null;
    }>(`
      SELECT u.name, u.age, u.city_name, u.about,
             (SELECT p.file_id FROM photos p 
              WHERE p.user_id = u.tg_id 
              ORDER BY p.is_main DESC, p.pos ASC LIMIT 1) as file_id
      FROM users u
      WHERE u.tg_id = $1
    `, [chatId]);

    const senderCard = sender.rows[0] || { name: null, age: null, city_name: null, about: null, file_id: null };
    const targetUserRow = await ensureUser(targetId, null);

    await sendScreen(bot, targetId, targetUserRow, {
      photoFileId: senderCard.file_id || undefined,
      text: senderCard.file_id ? undefined : buildUserCaption(senderCard),
      caption: senderCard.file_id ? buildUserCaption(senderCard) : undefined,
      keyboard: Keyboards.requestIncoming(crId, chatId)
    });

    await bot.sendMessage(chatId, "✅ Запрос на контакт отправлен!");
    
    // Возвращаемся к просмотру анкет
    await browseShowNext(bot, chatId, user);
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'send_contact_request');
    await bot.sendMessage(chatId, "Не удалось отправить запрос. Попробуйте позже.");
  }
}

export async function acceptContactRequest(bot: TelegramBot, chatId: number, user: DbUser, requestId: number) {
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
      WHERE id = $1::bigint AND to_id = $2::bigint AND status = 'pending'
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
      WHERE id = $1::bigint
    `, [requestId]);

    // Создаем контакт
    // Нормализуем порядок id (a<=b) и вставляем, если пары ещё нет
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
    `, [chatId, Number(from_id)]);

    // Получаем usernames/имена обеих сторон через Telegram API с fallback на БД
    async function resolveUserInfo(id: number): Promise<{ tg_id: number; username: string | null; name: string | null; }> {
      try {
        const chat = await bot.getChat(id);
        const username = (chat as any)?.username || null;
        const firstName = (chat as any)?.first_name || "";
        const lastName = (chat as any)?.last_name || "";
        const displayName = [firstName, lastName].filter(Boolean).join(" ") || null;
        // Обновляем БД актуальным username (не блокируя UX)
        try { await query(`UPDATE users SET username = COALESCE($2, username), updated_at = now() WHERE tg_id = $1`, [id, username]); } catch {}
        return { tg_id: id, username, name: displayName };
      } catch {
        const r = await query<{ tg_id: number; username: string | null; name: string | null }>(
          `SELECT tg_id, username, name FROM users WHERE tg_id = $1`, [id]
        );
        const row = r.rows[0] || { tg_id: id, username: null, name: null };
        return row;
      }
    }

    const uA = await resolveUserInfo(chatId);
    const uB = await resolveUserInfo(from_id);

    const contactLink = (u: typeof uA) => u.username ? `@${u.username}` : `tg://user?id=${u.tg_id}`;
    const nameSuffix = (u: typeof uA) => u.name ? ` (${u.name})` : "";

    // Сообщение принимающему с контактом инициатора (не падаем на ошибках доставки)
    try {
      await bot.sendMessage(chatId, `👤 Контакт: ${contactLink(uB)}${nameSuffix(uB)}`);
    } catch {}

    // Сообщение инициатору с контактом принимающего (не падаем на ошибках доставки)
    try {
      await bot.sendMessage(from_id, `✅ Ваш запрос принят!\n👤 Контакт: ${contactLink(uA)}${nameSuffix(uA)}`);
    } catch {}

    // Подтверждение принимающему (как отдельное сообщение, чтобы не падать на sendScreen)
    try { await bot.sendMessage(chatId, "✅ Контакт принят! Теперь вы можете общаться."); } catch {}

    // Вернём пользователя в главное меню, обновив клавиатуру экрана
    const freshUser = await ensureUser(chatId, user.username);
    await showMainMenu(bot, chatId, freshUser);
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'accept_contact_request');
    await sendScreen(bot, chatId, user, { text: "Не удалось принять запрос. Попробуйте позже." });
  }
}

export async function declineContactRequest(bot: TelegramBot, chatId: number, user: DbUser, requestId: number) {
  try {
    logger.userAction('decline_contact_request', chatId, chatId, { requestId });
    
    // Обновляем статус запроса
    await query(`
      UPDATE contact_requests 
      SET status = 'declined', decided_at = now() 
      WHERE id = $1 AND to_id = $2
    `, [requestId, chatId]);
    
    // Сообщение-подтверждение оставляем в чате
    try { await bot.sendMessage(chatId, "❌ Запрос отклонен."); } catch {}

    // Вернуть пользователя в главное меню с обновленной клавиатурой
    const freshUser = await ensureUser(chatId, user.username);
    await showMainMenu(bot, chatId, freshUser);
    
  } catch (error) {
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'decline_contact_request');
    try { await bot.sendMessage(chatId, "Не удалось отклонить запрос. Попробуйте позже."); } catch {}
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
