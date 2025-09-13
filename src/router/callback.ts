// src/router/callback.ts
import TelegramBot, { CallbackQuery } from "node-telegram-bot-api";
import { parseCb } from "../ui/cb";
import { ensureUser, isScreenExpired, sendScreen } from "../bot/helpers";
import { showHelp, showMainMenu } from "../bot/menu";
import { query } from "../db";
import { TXT } from "../ui/text";
import { mkCb } from "../ui/cb";
import { CB } from "../types";
import {
  regAskSeek, regAskCity, regAskPhoto, regShowPreview, regConfirm
} from "../bot/registration";
import { showProfile, getAllPhotoIds, buildProfileCaption } from "../bot/profile";
import { importPhotosFromTelegramProfile } from "../bot/photo";
import { showFavoritesList, addToFavorites, removeFromFavorites } from "../bot/favorites";
import { showContactRequestsList, sendContactRequest, acceptContactRequest, declineContactRequest } from "../bot/contacts";
import { reportUser } from "../bot/reports";
import { startRoulette, stopRoulette } from "../bot/roulette";
import { Keyboards } from "../ui/keyboards";
import { logger } from "../lib/logger";
import { ErrorHandler } from "../lib/errorHandler";

async function ack(bot: TelegramBot, id: string, text?: string) {
  try { await bot.answerCallbackQuery(id, text ? { text, show_alert: false } : undefined); } catch {}
}

function importFailText(): string {
  return [
    TXT.photo.importFailed,
    TXT.photo.importPrivacy,
    TXT.photo.importVideoNote,
    "",
    TXT.photo.importRetry,
  ].join("\n");
}

export async function handleCallback(bot: TelegramBot, cq: CallbackQuery) {
  try {
    const chatId = cq.message?.chat.id;
    if (!chatId || !cq.data) { 
      if (cq.id) await ack(bot, cq.id); 
      return; 
    }

    const parsed = parseCb(cq.data);
    if (!parsed) { 
      await ack(bot, cq.id); 
      return; 
    }

    const user = await ensureUser(chatId, cq.from?.username || null);
    if (!user || isScreenExpired(user)) {
      await ack(bot, cq.id, TXT.errors.screenExpired);
      await showMainMenu(bot, chatId, user);
      return;
    }

    const { prefix, verb, id } = parsed;
    
    logger.userAction(`callback_${prefix}_${verb}`, chatId, chatId, { id });

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
    if (verb === "photo_import") {
      await ack(bot, cq.id);
      const { regPhotoImport } = await import("../bot/registration");
      await regPhotoImport(bot, chatId, user);
      return;
    }
    if (verb === "photo_upload") {
      await ack(bot, cq.id);
      const { regPhotoUpload } = await import("../bot/registration");
      await regPhotoUpload(bot, chatId, user);
      return;
    }
    if (verb === "photo_method") {
      await ack(bot, cq.id);
      const { regPhotoMethodBack } = await import("../bot/registration");
      await regPhotoMethodBack(bot, chatId, user);
      return;
    }
    if (verb === "photo_nav") {
      await ack(bot, cq.id);
      const idx = Number(id ?? 0);
      
      // Проверяем состояние для определения типа навигации
      if (user.state === "reg_photo_import_preview") {
        const { regImportPreviewNav } = await import("../bot/registration");
        await regImportPreviewNav(bot, chatId, user, idx);
      } else if (user.state === "reg_photo_upload_preview") {
        const { regUploadPreviewNav } = await import("../bot/registration");
        await regUploadPreviewNav(bot, chatId, user, idx);
      } else {
        const { regPhotoCarouselNav } = await import("../bot/registration");
        await regPhotoCarouselNav(bot, chatId, user, idx);
      }
      return;
    }
    if (verb === "noop") {
      await ack(bot, cq.id);
      return;
    }
    if (verb === "photo_done") {
      await ack(bot, cq.id);
      
      // Если это предпросмотр импорта, сначала импортируем фото
      if (user.state === "reg_photo_import_preview") {
        const { regImportPhotos } = await import("../bot/registration");
        await regImportPhotos(bot, chatId, user);
        return;
      }
      
      // Если это предпросмотр загрузки, сохраняем фото
      if (user.state === "reg_photo_upload_preview") {
        const { regSaveUploadedPhotos } = await import("../bot/registration");
        await regSaveUploadedPhotos(bot, chatId, user);
        return;
      }
      
      // Иначе сразу завершаем регистрацию
      const { regConfirm } = await import("../bot/registration");
      await regConfirm(bot, chatId, user);
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
      await sendScreen(bot, chatId, user, { text: TXT.profile.editAbout });
      return;
    }
    if (verb === "photo") {
      await ack(bot, cq.id);
      await query(`UPDATE users SET state='edit_photo', updated_at=now() WHERE tg_id=$1`, [chatId]);
      const text = TXT.profile.photoInstructions + "\n\n" + TXT.profile.photoImportInfo;
      await sendScreen(bot, chatId, user, { text, keyboard: Keyboards.prfPhotoActions() });
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
        await sendScreen(bot, chatId, user, { text: importFailText(), keyboard: Keyboards.prfPhotoRetryActions() });
      }
      return;
    }
    if (verb === "photo_done") {
      await ack(bot, cq.id);
      const r = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
      if ((r.rows[0]?.c ?? 0) < 1) {
        await sendScreen(bot, chatId, user, { text: importFailText(), keyboard: Keyboards.prfPhotoRetryActions() });
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
      
      // Используем editMessageMedia для обновления только фото
      try {
        await bot.editMessageMedia({
          type: "photo",
          media: photos[safeIdx],
          caption,
          parse_mode: "HTML"
        }, {
          chat_id: chatId,
          message_id: user.last_screen_msg_id || undefined,
          reply_markup: { inline_keyboard: Keyboards.profileWithNav(total, safeIdx) }
        });
        return; // Успешно обновили, выходим
      } catch (error) {
        // Если не удалось обновить (например, сообщение устарело), показываем заново
        await sendScreen(bot, chatId, user, {
          photoFileId: photos[safeIdx],
          caption,
          keyboard: Keyboards.profileWithNav(total, safeIdx),
          parse_mode: "HTML",
        });
      }
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
        text: TXT.profile.restartConfirm,
        keyboard: [
          [{ text: TXT.profile.restartYes, callback_data: mkCb(CB.PRF, "restart_yes") }],
          [{ text: TXT.profile.restartCancel, callback_data: mkCb(CB.PRF, "open") }]
        ],
      });
      return;
    }

    if (verb === "restart_yes") {
      await ack(bot, cq.id);

      // Начинаем перерегистрацию с имени
      const { startRestartWithName } = await import("../bot/registration");
      await startRestartWithName(bot, chatId, user, cq.from?.first_name);
      return;
    }
  }

  // ===== BRW (Browse) =====
  if (prefix === "brw") {
    const { browseShowNext, getCandidatePhotos, buildCardCaption, getCurrentBrowseCandidate } = await import("../bot/browse");
    if (verb === "start" || verb === "next") {
      await ack(bot, cq.id);
      logger.userAction('browse_start', chatId, chatId);
      await browseShowNext(bot, chatId, user);
      return;
    }
    if (verb === "phnav") {
      await ack(bot, cq.id);
      const idx = Number(id ?? 0);
      
      // Получаем ID кандидата из последнего просмотренного
      const currentCandidateId = await getCurrentBrowseCandidate(chatId);
      if (!currentCandidateId) {
        await browseShowNext(bot, chatId, user);
        return;
      }
      
      const photos = await getCandidatePhotos(currentCandidateId);
      if (!photos.length) {
        await browseShowNext(bot, chatId, user);
        return;
      }
      
      const total = photos.length;
      const safeIdx = ((Number.isFinite(idx) ? idx : 0) % total + total) % total;

      // Получаем полные данные кандидата для подписи
      const candidateData = await query<{
        name: string | null;
        age: number | null;
        city_name: string | null;
        about: string | null;
        dist_km: number | null;
      }>(`
        SELECT u.name, u.age, u.city_name, u.about,
               CASE
                 WHEN u.geom IS NOT NULL AND (SELECT geom FROM users WHERE tg_id = $2) IS NOT NULL
                   THEN ST_DistanceSphere(u.geom, (SELECT geom FROM users WHERE tg_id = $2)) / 1000.0
                 ELSE NULL
               END AS dist_km
        FROM users u
        WHERE u.tg_id = $1
      `, [currentCandidateId, chatId]);

      const candidate = candidateData.rows[0];
      const caption = buildCardCaption({ 
        tg_id: currentCandidateId, 
        name: candidate?.name || null, 
        age: candidate?.age || null, 
        city_name: candidate?.city_name || null, 
        about: candidate?.about || null, 
        file_id: null, 
        dist_km: candidate?.dist_km || null 
      });
      
      // Используем editMessageMedia для обновления только фото
      try {
        await bot.editMessageMedia({
          type: "photo",
          media: photos[safeIdx],
          caption,
          parse_mode: "HTML"
        }, {
          chat_id: chatId,
          message_id: user.last_screen_msg_id || undefined,
          reply_markup: { inline_keyboard: Keyboards.browseCardWithNav(currentCandidateId, total, safeIdx) }
        });
        return; // Успешно обновили, выходим
      } catch (error) {
        // Если не удалось обновить (например, сообщение устарело), показываем заново
        await sendScreen(bot, chatId, user, {
          photoFileId: photos[safeIdx],
          caption,
          keyboard: Keyboards.browseCardWithNav(currentCandidateId, total, safeIdx),
          parse_mode: "HTML",
        });
      }
      return;
    }
    if (verb === "noop") {
      await ack(bot, cq.id);
      return;
    }
  }

  // ===== FAV (Favorites) =====
  if (prefix === "fav") {
    if (verb === "list") {
      await ack(bot, cq.id);
      await showFavoritesList(bot, chatId, user);
      return;
    }
    if (verb === "add" && id) {
      await ack(bot, cq.id);
      await addToFavorites(bot, chatId, user, Number(id));
      return;
    }
    if (verb === "remove" && id) {
      await ack(bot, cq.id);
      await removeFromFavorites(bot, chatId, user, Number(id));
      return;
    }
  }

  // ===== CR (Contact Requests) =====
  if (prefix === "cr") {
    if (verb === "list") {
      await ack(bot, cq.id);
      await showContactRequestsList(bot, chatId, user);
      return;
    }
    if (verb === "req" && id) {
      await ack(bot, cq.id);
      await sendContactRequest(bot, chatId, user, Number(id));
      return;
    }
    if (verb === "accept" && id) {
      await ack(bot, cq.id);
      await acceptContactRequest(bot, chatId, user, Number(id));
      return;
    }
    if (verb === "decline" && id) {
      await ack(bot, cq.id);
      await declineContactRequest(bot, chatId, user, Number(id));
      return;
    }
  }

  // ===== REP (Reports) =====
  if (prefix === "rep") {
    if (verb === "card" && id) {
      await ack(bot, cq.id);
      await reportUser(bot, chatId, user, Number(id), 'browse');
      return;
    }
    if (verb === "request" && id) {
      await ack(bot, cq.id);
      await reportUser(bot, chatId, user, Number(id), 'request');
      return;
    }
  }

  // ===== RL (Roulette) =====
  if (prefix === "rl") {
    if (verb === "find") {
      await ack(bot, cq.id);
      await startRoulette(bot, chatId, user);
      return;
    }
    if (verb === "stop") {
      await ack(bot, cq.id);
      await stopRoulette(bot, chatId, user);
      return;
    }
  }

    // Fallback для неизвестных команд
    logger.warn("Unknown callback received", {
      action: 'unknown_callback',
      chatId,
      userId: chatId,
      callback: cq.data
    });
    
    await ack(bot, cq.id, TXT.errors.commandUnknown);
    await showMainMenu(bot, chatId, user);
    
  } catch (error) {
    const chatId = cq.message?.chat.id || 0;
    await ErrorHandler.handleUserError(error as Error, chatId, chatId, 'callback_handler');
    await ack(bot, cq.id, TXT.errors.errorOccurred);
  }
}
