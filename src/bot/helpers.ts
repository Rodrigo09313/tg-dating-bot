// src/bot/helpers.ts
// Вспомогательные утилиты бота: ensureUser, setState, sendScreen (один живой экран).
// Код безопасен к "пустому тексту": никогда не пошлём пустой message/caption.

import TelegramBot, { InlineKeyboardButton } from "node-telegram-bot-api";
import { query } from "../db";
import { logger } from "../lib/logger";

// Тип пользователя как мы его обычно читаем из БД.
// Поля минимально необходимые для экранов/состояний.
export type DbUser = {
  tg_id: number;
  username: string | null;
  name: string | null;
  state: string | null;
  status: "new" | "active" | "blocked" | "shadow" | null;
  last_screen_msg_id: number | null;
  last_screen_at: string | null;
};

// Создаём пользователя при первом контакте; обновляем username; возвращаем актуальную строку.
export async function ensureUser(tgId: number, username?: string | null): Promise<DbUser> {
  const res = await query<DbUser>(
    `
    INSERT INTO users (tg_id, username, status, created_at, updated_at)
    VALUES ($1, $2, 'new', now(), now())
    ON CONFLICT (tg_id) DO UPDATE SET
      username   = COALESCE($2, users.username),
      updated_at = now()
    RETURNING tg_id, username, name, state, status, last_screen_msg_id, last_screen_at
    `,
    [tgId, username ?? null]
  );
  return res.rows[0];
}

// Установить состояние пользователя.
export async function setState(chatId: number, state: string | null) {
  await query(
    `UPDATE users SET state = $2, updated_at = now() WHERE tg_id = $1`,
    [chatId, state]
  );
}

// Унифицированная отправка экрана: удаляет старый экран, шлёт новый, запоминает message_id.
// Поддерживает текст ИЛИ фото с подписью и inline-кнопки.
export async function sendScreen(
  bot: TelegramBot,
  chatId: number,
  user: DbUser,
  opts: {
    text?: string;                              // текст сообщения (если без фото)
    photoFileId?: string;                       // file_id фото (если отправляем фото)
    caption?: string;                           // подпись к фото (если отправляем фото)
    parse_mode?: "HTML" | "Markdown" | "MarkdownV2" | string;
    disable_web_page_preview?: boolean;         // для текстовых сообщений
    keyboard?: InlineKeyboardButton[][];
    reply_markup?: any;                         // для обычных клавиатур
  }
) {
  // Обновляем пользователя перед отправкой экрана для получения актуального last_screen_msg_id
  const updatedUser = await ensureUser(chatId, user.username);
  const o = { ...(opts || {}) };

  const hasPhoto   = typeof o.photoFileId === "string" && o.photoFileId.length > 0;
  const hasText    = typeof o.text === "string" && o.text.trim().length > 0;
  const hasCaption = typeof o.caption === "string" && o.caption.trim().length > 0;

  // Никогда не отсылаем пустое: Telegram вернёт 400.
  if (!hasPhoto && !hasText) {
    o.text = "—";
  }
  if (hasPhoto && !hasCaption && !hasText) {
    o.caption = "—";
  }

  // Один живой экран: удаляем предыдущее сообщение бота, если помним его id.
  const lastId = updatedUser?.last_screen_msg_id;
  if (lastId) {
    try { 
      await bot.deleteMessage(chatId, lastId); 
    } catch (error) {
      // Если не удалось удалить конкретное сообщение, очищаем все сообщения бота
      logger.warn("Failed to delete specific message, clearing all bot messages", {
        action: 'delete_message_failed',
        chatId,
        lastId,
        error: error instanceof Error ? error : new Error(String(error))
      });
      // Не очищаем все сообщения - это создает проблемы
      logger.warn("Message deletion failed, but continuing without clearing all messages", {
        action: 'message_deletion_failed_continue',
        chatId,
        lastId
      });
    }
  }
  // Убираем принудительную очистку - она создает проблемы

  const reply_markup = o.keyboard ? { inline_keyboard: o.keyboard } : o.reply_markup;

  let sent:
    | TelegramBot.Message
    | TelegramBot.MessageId
    | (TelegramBot.Message & { message_id: number });

  if (hasPhoto) {
    try {
      // Сначала пытаемся получить URL файла
      const fileUrl = await bot.getFileLink(o.photoFileId as string);
      sent = await bot.sendPhoto(chatId, fileUrl, {
        caption: hasCaption ? o.caption : (o.text || undefined),
        parse_mode: o.parse_mode || "HTML",
        reply_markup,
        disable_notification: true,
      } as any);
    } catch (error: any) {
      // Если не удалось получить URL или отправить по URL, используем file_id
      logger.warn("Failed to send photo with URL, falling back to file_id", {
        action: 'send_photo_fallback',
        chatId,
        error: error?.message || 'Unknown error'
      });
      
      try {
        sent = await bot.sendPhoto(chatId, o.photoFileId as string, {
          caption: hasCaption ? o.caption : (o.text || undefined),
          parse_mode: o.parse_mode || "HTML",
          reply_markup,
          disable_notification: true,
        } as any);
      } catch (fileIdError: any) {
        // Если и file_id не работает (например, FILE_REFERENCE_EXPIRED), отправляем текстовое сообщение
        logger.warn("Failed to send photo with file_id, falling back to text message", {
          action: 'send_photo_file_id_fallback',
          chatId,
          error: fileIdError?.message || 'Unknown error'
        });
        
        const fallbackText = hasCaption ? o.caption : (o.text || "Фото временно недоступно");
        sent = await bot.sendMessage(chatId, fallbackText || "Фото временно недоступно", {
          parse_mode: o.parse_mode || "HTML",
          reply_markup,
          disable_web_page_preview: true,
          disable_notification: true,
        } as any);
      }
    }
  } else {
    sent = await bot.sendMessage(chatId, (o.text as string), {
      parse_mode: o.parse_mode || "HTML",
      reply_markup,
      disable_web_page_preview: o.disable_web_page_preview ?? true,
      disable_notification: true,
    } as any);
  }

  const msgId = (sent as TelegramBot.Message).message_id ?? (sent as any).message_id;

  // Запоминаем id экрана — чтобы удалить при следующем показе.
  try {
    await query(
      `
      UPDATE users
         SET last_screen_msg_id = $2::bigint,
             last_screen_at     = now()
       WHERE tg_id = $1
      `,
      [chatId, msgId]
    );
  } catch {
    // Не блокируем UX проблемами записи вспомогательных полей.
  }

  return sent as TelegramBot.Message;
}


// TTL «живого экрана» (по умолчанию 5 минут = 300000 мс)
export const SCREEN_TTL_MS = (() => {
  const env = Number(process.env.SCREEN_TTL_MS);
  return Number.isFinite(env) && env > 0 ? env : 5 * 60 * 1000;
})();

/**
 * Проверка, что экран устарел (по last_screen_at).
 * Если даты нет/некорректна — считаем, что устарел (true), чтобы вернуть пользователя в актуальный экран.
 */
export function isScreenExpired(user: DbUser, nowMs: number = Date.now()): boolean {
  const iso = user?.last_screen_at;
  if (!iso) return true;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return true;
  return (nowMs - ts) > SCREEN_TTL_MS;
}

// Принудительная очистка всех сообщений бота в чате (для случаев наложения клавиатур)
export async function clearBotMessages(bot: TelegramBot, chatId: number): Promise<void> {
  try {
    // Получаем информацию о чате
    const chat = await bot.getChat(chatId);
    if (chat.type !== 'private') return; // Только для приватных чатов
    
    // Пытаемся удалить последние 20 сообщений (обычно этого достаточно)
    let deletedCount = 0;
    for (let i = 1; i <= 20; i++) {
      try {
        await bot.deleteMessage(chatId, (Date.now() / 1000) - i);
        deletedCount++;
      } catch {
        // Игнорируем ошибки - некоторые сообщения могут не существовать
      }
    }
    
    logger.info("Cleared bot messages", {
      action: 'clear_bot_messages',
      chatId,
      deletedCount
    });
  } catch (error) {
    logger.warn("Failed to clear bot messages", {
      action: 'clear_bot_messages_failed',
      chatId,
      error: error instanceof Error ? error : new Error(String(error))
    });
  }
}
