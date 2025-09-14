// src/bot/helpers.ts
// Вспомогательные утилиты бота: ensureUser, setState, sendScreen (один живой экран).
// Код безопасен к "пустому тексту": никогда не пошлём пустой message/caption.

import { Telegraf, Context, Markup } from 'telegraf';
import { query } from "../db";

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
export type InlineButton = { text: string; callback_data: string };

export async function sendScreen(
  bot: Telegraf<Context>,
  chatId: number,
  user: DbUser,
  opts: {
    text?: string;
    photoFileId?: string;
    caption?: string;
    parse_mode?: "HTML" | "Markdown" | "MarkdownV2" | string;
    disable_web_page_preview?: boolean;
    keyboard?: InlineButton[][];
    reply_markup?: any;
  }
) {
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
  const lastId = user?.last_screen_msg_id;
  if (lastId) {
    try { await bot.telegram.deleteMessage(chatId, lastId); } catch {}
  }

  const reply_markup = o.keyboard
    ? Markup.inlineKeyboard(
        o.keyboard.map(row => row.map(btn => Markup.button.callback(btn.text, btn.callback_data)))
      ).reply_markup
    : o.reply_markup;

  let sent: any;

  if (hasPhoto) {
    sent = await bot.telegram.sendPhoto(chatId, o.photoFileId as string, {
      caption: hasCaption ? o.caption : (o.text || undefined),
      parse_mode: o.parse_mode || 'HTML',
      reply_markup,
      disable_notification: true,
    });
  } else {
    sent = await bot.telegram.sendMessage(chatId, o.text as string, {
      parse_mode: o.parse_mode || 'HTML',
      reply_markup,
      disable_web_page_preview: o.disable_web_page_preview ?? true,
      disable_notification: true,
    });
  }

  const msgId = (sent as any).message_id;

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

  return sent as any;
}


// TTL «живого экрана» (по умолчанию 5 минут = 300000 мс)
export const SCREEN_TTL_MS = (() => {
  const env = Number(process.env.SCREEN_TTL_MS ?? process.env.SCREEN_TTL_MS_MS);
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
