// src/lib/hideReply.ts
import { Telegraf } from 'telegraf';

/**
 * Скрывает reply-клавиатуру без визуального мусора:
 * отправляем краткое служебное сообщение (".") с remove_keyboard и тут же удаляем.
 * Нельзя отправлять "пустой" или одни управляющие символы — Telegram вернёт 400.
 */
export async function hideReplyKeyboard(bot: Telegraf, chatId: number) {
  try {
    const m = await bot.telegram.sendMessage(chatId, ".", {
      reply_markup: { remove_keyboard: true },
      disable_notification: true,
    });
    // удаляем мгновенно, чтобы сохранить "один живой экран"
    await bot.telegram.deleteMessage(chatId, m.message_id).catch(() => {});
  } catch (e) {
    // проглатываем — скрытие клавиатуры — best-effort
  }
}
