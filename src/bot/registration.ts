// src/bot/photoUpload.ts
// UI-флоу для блока "Фото" (используется и в регистрации, и в редактировании).
// Здесь: выбор метода, предпросмотр импорта, подтверждение импорта,
// старт режима загрузки, показ карусели сохранённых, и приём входящих фото для upload.

import TelegramBot, { Message } from "node-telegram-bot-api";
import { query } from "../db.js";
import { DbUser, sendScreen, setState } from "./helpers.js";
import { Keyboards } from "../ui/keyboards.js";
import { logger } from "../lib/logger.js";
import {
  MAX_PROFILE_PHOTOS,
  MAX_UPLOAD_PER_SESSION,
  getAllUserPhotos,
  getTelegramProfilePhotosForPreview,
  importPhotosFromTelegramProfile,
  addPhotoSafely,
  validatePhoto,
  getBestPhotoSize,
} from "./photo.js";
import {
  createUploadSession,
  addPhotoToSession,
  getSessionPhotos,
  clearUploadSession,
  canAddMorePhotos,
  isProcessing,
  setProcessingFlag,
} from "../lib/uploadSession.js";

/** Общий текст экрана выбора метода с текущим количеством фото. */
function buildPhotoText(current: number): string {
  return [
    `Добавьте фото для профиля.`,
    `Можно:`,
    `• 📥 Импортировать из вашего профиля Telegram;`,
    `• 📤 Загрузить из галереи.`,
    ``,
    `Сейчас в профиле: ${current}/${MAX_PROFILE_PHOTOS}.`,
    `ℹ️ Импортируются только <b>видимые боту</b> аватары Telegram (видео-аватар не импортируется).`,
  ].join("\n");
}

/** Показать выбор метода (импорт/загрузка/готово) */
export async function askPhotoMethod(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_photo_method");
  const r = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`,
    [chatId]
  );
  const c = r.rows[0]?.c ?? 0;

  await sendScreen(bot, chatId, user, {
    text: buildPhotoText(c),
    keyboard: Keyboards.regPhotoMethodWithDone(),
    parse_mode: "HTML",
  });
}

/** Предпросмотр импорта из Telegram-профиля (без записи в БД) */
export async function importPreview(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_photo_import_preview");

  const r = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`,
    [chatId]
  );
  const current = r.rows[0]?.c ?? 0;

  if (current >= MAX_PROFILE_PHOTOS) {
    await sendScreen(bot, chatId, user, {
      text: `У вас уже максимальное количество фото (${MAX_PROFILE_PHOTOS}).`,
      keyboard: Keyboards.regPhotoMethodWithDone(),
    });
    return;
  }

  const slots = Math.max(0, MAX_PROFILE_PHOTOS - current);
  const profilePhotos = await getTelegramProfilePhotosForPreview(bot, chatId, slots);

  if (profilePhotos.length === 0) {
    await sendScreen(bot, chatId, user, {
      text: `Не удалось найти фото в вашем профиле Telegram.\n\nЗагрузите из галереи или попробуйте позже.`,
      keyboard: Keyboards.regPhotoMethodWithDone(),
    });
    return;
  }

  await sendScreen(bot, chatId, user, {
    photoFileId: profilePhotos[0],
    caption: `📥 Найдено ${profilePhotos.length} фото в вашем профиле\n\nПросмотри и нажми «Готово» для добавления в профиль.`,
    keyboard: Keyboards.regPhotoCarousel(profilePhotos.length, 0),
  });
}

/** Подтвердить импорт (импортируем до заполнения свободных слотов) */
export async function importConfirm(bot: TelegramBot, chatId: number, user: DbUser) {
  const r = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`,
    [chatId]
  );
  const before = r.rows[0]?.c ?? 0;
  const slots = Math.max(0, MAX_PROFILE_PHOTOS - before);
  if (slots <= 0) {
    await sendScreen(bot, chatId, user, {
      text: `У вас уже максимальное количество фото (${MAX_PROFILE_PHOTOS}).`,
      keyboard: Keyboards.regPhotoMethodWithDone(),
    });
    return;
  }

  const imported = await importPhotosFromTelegramProfile(bot, chatId, {
    replace: false,
    limit: slots,
  });

  const r2 = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`,
    [chatId]
  );
  const total = r2.rows[0]?.c ?? 0;

  if (imported <= 0 && total === before) {
    await sendScreen(bot, chatId, user, {
      text: `Не удалось импортировать фото из вашего профиля Telegram.`,
      keyboard: Keyboards.regPhotoMethodWithDone(),
    });
    return;
  }

  if (total < MAX_PROFILE_PHOTOS) {
    await sendScreen(bot, chatId, user, {
      text: `📥 Импортировано: ${imported}. Сейчас в профиле: ${total}/${MAX_PROFILE_PHOTOS}.\n` +
            `Можете добавить ещё (импорт/загрузка) или нажать «Готово».`,
      keyboard: Keyboards.regPhotoMethodWithDone(),
      parse_mode: "HTML",
    });
  } else {
    // слоты закончены — можно завершать регистрацию
    await sendScreen(bot, chatId, user, {
      text: `Фото добавлены (${total}/${MAX_PROFILE_PHOTOS}). Можете продолжать.`,
      keyboard: Keyboards.regPhotoMethodWithDone(),
    });
  }
}

/** Начать режим загрузки из галереи: выставляем state и подсказываем пользователю */
export async function uploadStart(bot: TelegramBot, chatId: number, user: DbUser) {
  const r = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`,
    [chatId]
  );
  const current = r.rows[0]?.c ?? 0;
  if (current >= MAX_PROFILE_PHOTOS) {
    await sendScreen(bot, chatId, user, {
      text: `У вас уже максимальное количество фото (${MAX_PROFILE_PHOTOS}).`,
      keyboard: Keyboards.regPhotoMethodWithDone(),
    });
    return;
  }

  // разовый лимит с учётом остатка
  const maxPerSession = Math.min(MAX_UPLOAD_PER_SESSION, MAX_PROFILE_PHOTOS - current);
  createUploadSession(chatId, maxPerSession);

  await setState(chatId, "reg_photo_upload");
  await sendScreen(bot, chatId, user, {
    text:
      `📤 Загрузите 1–${maxPerSession} фото сообщениями.\n` +
      `Когда закончите, нажмите «Готово».`,
    keyboard: Keyboards.regPhotoUpload(),
  });
}

/** Показать карусель уже сохранённых в БД фото (опционально) */
export async function showSavedCarousel(bot: TelegramBot, chatId: number, user: DbUser) {
  const photos = await getAllUserPhotos(chatId);
  if (photos.length === 0) {
    await sendScreen(bot, chatId, user, {
      text: `Фото ещё нет. Импортируйте или загрузите.`,
      keyboard: Keyboards.regPhotoMethodWithDone(),
    });
    return;
  }
  await sendScreen(bot, chatId, user, {
    photoFileId: photos[0],
    caption: `📸 Просмотр фото 1/${photos.length}\n\nНажмите «Готово», чтобы продолжить.`,
    keyboard: Keyboards.regPhotoCarousel(photos.length, 0),
  });
}

/** Приём входящих msg.photo в режиме state=reg_photo_upload */
export async function handleUploadPhotoMessage(
  bot: TelegramBot,
  msg: Message,
  user: DbUser
) {
  const chatId = msg.chat.id;

  if (user.state !== "reg_photo_upload") {
    await sendScreen(bot, chatId, user, {
      text: "Сначала выберите способ добавления фото.",
      keyboard: Keyboards.regPhotoMethodWithDone(),
    });
    return;
  }

  if (!msg.photo || msg.photo.length === 0) {
    await sendScreen(bot, chatId, user, {
      text: "Пожалуйста, отправьте именно фотографию.",
      keyboard: Keyboards.regPhotoUpload(),
    });
    return;
  }

  const best = getBestPhotoSize(msg.photo);
  if (!best) {
    await sendScreen(bot, chatId, user, {
      text: "Не удалось обработать фото. Попробуйте другое.",
      keyboard: Keyboards.regPhotoUpload(),
    });
    return;
  }

  const v = validatePhoto(best);
  if (!v.valid) {
    await sendScreen(bot, chatId, user, {
      text: v.error || "Фото не прошло валидацию.",
      keyboard: Keyboards.regPhotoUpload(),
    });
    return;
  }

  if (!canAddMorePhotos(chatId)) {
    await sendScreen(bot, chatId, user, {
      text: `Лимит на эту загрузку достигнут (${MAX_UPLOAD_PER_SESSION}). Нажмите «Готово».`,
      keyboard: Keyboards.regPhotoUpload(),
    });
    return;
  }

  const res = addPhotoToSession(chatId, best.file_id);
  if (!res.success) {
    await sendScreen(bot, chatId, user, {
      text: res.error || "Не удалось добавить фото.",
      keyboard: Keyboards.regPhotoUpload(),
    });
    return;
  }

  // мягкий batching для пачки фото
  if (isProcessing(chatId)) return;
  setProcessingFlag(chatId, true);
  try {
    await new Promise(r => setTimeout(r, 900));

    const files = getSessionPhotos(chatId);
    await sendScreen(bot, chatId, user, {
      photoFileId: files[0],
      caption:
        `📤 Вы выбрали ${files.length} фото.\n` +
        `Когда закончите — нажмите «Готово».`,
      keyboard: Keyboards.regPhotoCarousel(files.length, 0),
    });
  } finally {
    setProcessingFlag(chatId, false);
  }
}

/** Завершить upload-сессию: перенести из сессии в БД с учётом лимита */
export async function finalizeUploadSessionToDb(
  bot: TelegramBot,
  chatId: number,
  user: DbUser
) {
  const files = getSessionPhotos(chatId);
  if (files.length === 0) {
    await askPhotoMethod(bot, chatId, user);
    return;
  }

  const r = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`,
    [chatId]
  );
  const current = r.rows[0]?.c ?? 0;
  const slots = Math.max(0, MAX_PROFILE_PHOTOS - current);
  if (slots <= 0) {
    clearUploadSession(chatId);
    await sendScreen(bot, chatId, user, {
      text: `Максимум фото уже достигнут (${MAX_PROFILE_PHOTOS}).`,
      keyboard: Keyboards.regPhotoMethodWithDone(),
    });
    return;
  }

  const toSave = files.slice(0, slots);
  let saved = 0;
  for (const fid of toSave) {
    try {
      const r = await addPhotoSafely(chatId, fid);
      if ("skippedDuplicate" in r) continue;
      saved++;
    } catch (e: any) {
      if (e?.message === "LIMIT_REACHED") break;
      logger.warn("save photo failed", { error: String(e) });
    }
  }
  clearUploadSession(chatId);

  const r2 = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`,
    [chatId]
  );
  const total = r2.rows[0]?.c ?? 0;

  await sendScreen(bot, chatId, user, {
    text: `📤 Сохранено: ${saved}. Сейчас в профиле: ${total}/${MAX_PROFILE_PHOTOS}.`,
    keyboard: Keyboards.regPhotoMethodWithDone(),
  });
}
