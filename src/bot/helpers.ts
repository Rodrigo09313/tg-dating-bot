// src/bot/helpers.ts
import TelegramBot, { InlineKeyboardButton } from "node-telegram-bot-api";
import { query } from "../db";
import { SCREEN_TTL_MS } from "../config";
import { UserState } from "../types";

export type DbUser = {
  tg_id: string;
  username: string | null;
  name: string | null;
  state: string | null;
  last_screen_msg_id: string | null;
  last_screen_at: string | null;
  status: string;
};

// Создаем/обновляем пользователя
export async function ensureUser(tgId: number, username?: string | null): Promise<DbUser> {
  const res = await query<DbUser>(`
    INSERT INTO users (tg_id, username, status)
    VALUES ($1, $2, 'new')
    ON CONFLICT (tg_id) DO UPDATE SET username = EXCLUDED.username, updated_at = now()
    RETURNING tg_id::text, username, name, state, last_screen_msg_id::text, last_screen_at::text, status
  `, [tgId, username ?? null]);
  return res.rows[0];
}

export async function setState(tgId: number, state: UserState | null) {
  await query(`UPDATE users SET state = $2, updated_at = now() WHERE tg_id = $1`, [tgId, state]);
}

export async function deleteOldScreen(bot: TelegramBot, chatId: number, user: DbUser) {
  if (!user.last_screen_msg_id) return;
  try { await bot.deleteMessage(chatId, Number(user.last_screen_msg_id)); } catch {}
}

export function isScreenExpired(user: DbUser): boolean {
  if (!user.last_screen_at) return true;
  const ts = new Date(user.last_screen_at).getTime();
  return Date.now() - ts > SCREEN_TTL_MS;
}

export async function sendScreen(
  bot: TelegramBot,
  chatId: number,
  user: DbUser,
  payload: { text?: string; photoFileId?: string; caption?: string; keyboard?: InlineKeyboardButton[][] }
): Promise<void> {
  await deleteOldScreen(bot, chatId, user);

  let msgId: number;
  if (payload.photoFileId) {
    const sent = await bot.sendPhoto(chatId, payload.photoFileId, {
      caption: payload.caption || "",
      reply_markup: payload.keyboard ? { inline_keyboard: payload.keyboard } : undefined,
      parse_mode: "HTML",
    });
    msgId = sent.message_id;
  } else {
    const sent = await bot.sendMessage(chatId, payload.text || "", {
      reply_markup: payload.keyboard ? { inline_keyboard: payload.keyboard } : undefined,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    msgId = sent.message_id;
  }

  await query(`UPDATE users SET last_screen_msg_id = $2, last_screen_at = now(), updated_at = now() WHERE tg_id = $1`,
    [chatId, msgId]);
}
