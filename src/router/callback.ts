// src/router/callback.ts
import TelegramBot, { CallbackQuery } from "node-telegram-bot-api";
import { parseCb } from "../ui/cb";
import { ensureUser, isScreenExpired, sendScreen } from "../bot/helpers";
import { showHelp, showMainMenu } from "../bot/menu";
import { query } from "../db";
import {
  regAskSeek, regAskCity, regAskPhoto, regShowPreview, regConfirm
} from "../bot/registration";
import { showProfile, getAllPhotoIds, buildProfileCaption } from "../bot/profile";
import { importPhotosFromTelegramProfile } from "../bot/photo";
import { kb } from "../ui/buttons";

async function ack(bot: TelegramBot, id: string, text?: string) {
  try { await bot.answerCallbackQuery(id, text ? { text, show_alert: false } : undefined); } catch {}
}

function importFailText(): string {
  return [
    "Не удалось импортировать: Telegram вернул 0 фото.",
    "Проверь настройки приватности: <b>Настройки → Конфиденциальность → Фото профиля</b> = «Все».",
    "Также убедись, что в профиле есть <b>обычные фото</b> — видео-аватар не импортируется.",
    "",
    "Можешь повторить импорт или отправить 1–3 фото вручную.",
  ].join("\n");
}

export async function handleCallback(bot: TelegramBot, cq: CallbackQuery) {
  const chatId = cq.message?.chat.id;
  if (!chatId || !cq.data) { if (cq.id) await ack(bot, cq.id); return; }

  const parsed = parseCb(cq.data);
  if (!parsed) { await ack(bot, cq.id); return; }

  const user = await ensureUser(chatId, cq.from?.username || null);
  if (!user || isScreenExpired(user)) {
    await ack(bot, cq.id, "Экран устарел");
    await showMainMenu(bot, chatId, user);
    return;
  }

  const { prefix, verb, id } = parsed;

  // ===== SYS =====
  if (prefix === "sys") {
    if (verb === "help") {
      await ack(bot, cq.id);
      await showHelp(bot, chatId, user);
      return;
    }
    if (verb === "menu") {
      await ack(bot, cq.id);
      await showMainMenu(bot, chatId, user);
      return;
    }
  }

  // ===== REG =====
  if (prefix === "reg") {
    if (verb === "gender" && (id === "m" || id === "f")) {
      await ack(bot, cq.id);
      await query(`UPDATE users SET gender=$2, updated_at=now() WHERE tg_id=$1`, [chatId, id]);
      await regAskSeek(bot, chatId, user);
      return;
    }
    if (verb === "seek" && id && ["m","f","b"].includes(id)) {
      await ack(bot, cq.id);
      await query(`UPDATE users SET seek=$2, updated_at=now() WHERE tg_id=$1`, [chatId, id]);
      await regAskCity(bot, chatId, user);
      return;
    }
    if (verb === "about_skip") {
      await ack(bot, cq.id);
      await regAskPhoto(bot, chatId, user);
      return;
    }
    if (verb === "photo_import") {
      await ack(bot, cq.id);
      const imported = await importPhotosFromTelegramProfile(bot, chatId, { replace: false, limit: 3 });
      if (imported > 0) {
        await regShowPreview(bot, chatId, user);
      } else {
        await sendScreen(bot, chatId, user, { text: importFailText(), keyboard: kb.regPhotoRetryActions() });
      }
      return;
    }
    if (verb === "photo_done") {
      await ack(bot, cq.id);
      const r = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
      if ((r.rows[0]?.c ?? 0) < 1) {
        await sendScreen(bot, chatId, user, { text: importFailText(), keyboard: kb.regPhotoRetryActions() });
        return;
      }
      await regShowPreview(bot, chatId, user);
      return;
    }
    if (verb === "photo_again") {
      await ack(bot, cq.id);
      await regAskPhoto(bot, chatId, user);
      return;
    }
    if (verb === "confirm") {
      await ack(bot, cq.id);
      await regConfirm(bot, chatId, user);
      return;
    }
  }

  // ===== PRF =====
  if (prefix === "prf") {
    if (verb === "open") {
      await ack(bot, cq.id);
      await showProfile(bot, chatId, user);
      return;
    }
    if (verb === "about") {
      await ack(bot, cq.id);
      await query(`UPDATE users SET state='edit_about', updated_at=now() WHERE tg_id=$1`, [chatId]);
      await bot.sendMessage(chatId, "Напиши новый текст «О себе» (до 300 символов).");
      return;
    }
    if (verb === "photo") {
      await ack(bot, cq.id);
      await query(`UPDATE users SET state='edit_photo', updated_at=now() WHERE tg_id=$1`, [chatId]);
      const text = [
        "Фото профиля: пришли 1–3 фото или используй импорт.",
        "",
        "ℹ️ Импорт видит только фото, доступные боту:",
        "• Приватность «Фото профиля» должна быть «Все»;",
        "• Видео-аватар не импортируется, только фото;",
        "• Максимум 3 фото.",
      ].join("\n");
      await sendScreen(bot, chatId, user, { text, keyboard: kb.prfPhotoActions() });
      return;
    }
    if (verb === "photo_import") {
      await ack(bot, cq.id);
      await query(`DELETE FROM photos WHERE user_id=$1`, [chatId]);
      const imported = await importPhotosFromTelegramProfile(bot, chatId, { replace: true, limit: 3 });
      if (imported > 0) {
        await query(`UPDATE users SET state='idle', updated_at=now() WHERE tg_id=$1`, [chatId]);
        await showProfile(bot, chatId, user);
      } else {
        await sendScreen(bot, chatId, user, { text: importFailText(), keyboard: kb.prfPhotoRetryActions() });
      }
      return;
    }
    if (verb === "photo_done") {
      await ack(bot, cq.id);
      const r = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
      if ((r.rows[0]?.c ?? 0) < 1) {
        await sendScreen(bot, chatId, user, { text: importFailText(), keyboard: kb.prfPhotoRetryActions() });
        return;
      }
      await query(`UPDATE users SET state='idle', updated_at=now() WHERE tg_id=$1`, [chatId]);
      await showProfile(bot, chatId, user);
      return;
    }

    // Навигация по фото-карусели
    if (verb === "phnav") {
      await ack(bot, cq.id);
      const idx = Number(id ?? 0);
      const photos = await getAllPhotoIds(chatId);
      if (!photos.length) {
        await showProfile(bot, chatId, user);
        return;
      }
      const total = photos.length;
      const safeIdx = ((Number.isFinite(idx) ? idx : 0) % total + total) % total;

      const caption = await buildProfileCaption(chatId);
      const media: TelegramBot.InputMediaPhoto = {
        type: "photo",
        media: photos[safeIdx],
        caption,
        parse_mode: "HTML",
      };

      await bot.editMessageMedia(media, {
        chat_id: chatId,
        message_id: cq.message!.message_id,
        reply_markup: { inline_keyboard: kb.profileWithNav(total, safeIdx) }
      });
      return;
    }

    // Ничего не делать (центр "x/y")
    if (verb === "noop") {
      await ack(bot, cq.id);
      return;
    }

    // Подтверждение «пересоздать анкету»
    if (verb === "restart_confirm") {
      await ack(bot, cq.id);
      await sendScreen(bot, chatId, user, {
        text: "Сбросить анкету и пройти регистрацию заново?",
        keyboard: [
          [{ text: "✅ Да, сбросить", callback_data: "prf:restart_yes" }],
          [{ text: "❌ Отмена",      callback_data: "prf:open" }]
        ],
      });
      return;
    }

    if (verb === "restart_yes") {
      await ack(bot, cq.id);

      // Сбрасываем данные пользователя
      await query(`DELETE FROM photos WHERE user_id=$1`, [chatId]);
      await query(`
        UPDATE users
        SET name=NULL, age=NULL, gender=NULL, seek=NULL,
            city_name=NULL, geom=NULL, about=NULL,
            status='new', state=NULL, updated_at=now()
        WHERE tg_id=$1
      `, [chatId]);

      // Начинаем регистрацию заново
      const { regAskAge } = await import("../bot/registration");
      await regAskAge(bot, chatId, user);
      return;
    }
  }

  // Fallback: меню
  await ack(bot, cq.id, "Скоро будет");
  await showMainMenu(bot, chatId, user);
}
