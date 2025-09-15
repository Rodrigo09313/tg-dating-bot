// src/bot/registration.ts
import TelegramBot, { Message, ReplyKeyboardMarkup, KeyboardButton } from "node-telegram-bot-api";
import { query } from "../db";
import { DbUser, sendScreen, setState } from "./helpers";
import { TXT } from "../ui/text";
import { Keyboards } from "../ui/keyboards";
import { mkCb } from "../ui/cb";
import { CB } from "../types";
import { showProfile } from "./profile";
import { importPhotosFromTelegramProfile, addPhotoSafely, checkTelegramProfilePhotos, getAllUserPhotos, getTelegramProfilePhotosForPreview, validatePhoto, getBestPhotoSize } from "./photo";
import { createUploadSession, addPhotoToSession, getSessionPhotos, clearUploadSession, canAddMorePhotos, getPhotoCount, setProcessingFlag, isProcessing } from "../lib/uploadSession";
import { reverseGeocode } from "../lib/geocode";
import { hideReplyKeyboard } from "../lib/hideReply";

// === Валидация имени ===
export function validateName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  
  // Проверяем длину
  if (trimmed.length < 2) {
    return { valid: false, error: TXT.validation.nameMinLength };
  }
  
  if (trimmed.length > 50) {
    return { valid: false, error: TXT.validation.nameMaxLength };
  }
  
  // Проверяем разрешенные символы: буквы, пробелы, дефисы
  const allowedPattern = /^[a-zA-Zа-яА-ЯёЁ\s\-]+$/;
  if (!allowedPattern.test(trimmed)) {
    return { valid: false, error: TXT.validation.nameInvalidChars };
  }
  
  // Проверяем, что не состоит только из пробелов и дефисов
  const hasLetters = /[a-zA-Zа-яА-ЯёЁ]/.test(trimmed);
  if (!hasLetters) {
    return { valid: false, error: TXT.validation.nameNoLetters };
  }
  
  return { valid: true };
}

// === Обработка имени при старте ===
export async function handleStartName(bot: TelegramBot, chatId: number, user: DbUser, firstName?: string) {
  if (firstName && firstName.trim()) {
    // Вариант A: first_name доступен
    const validation = validateName(firstName);
    if (validation.valid) {
      // Сохраняем имя и переходим к возрасту
      await query(`UPDATE users SET name=$2, updated_at=now() WHERE tg_id=$1`, [chatId, firstName.trim()]);
      await sendScreen(bot, chatId, user, { 
        text: TXT.start.welcome.replace('{name}', firstName.trim())
      });
      await regAskAge(bot, chatId, user);
      return;
    }
  }
  
  // Вариант B: first_name недоступен или невалиден - запрашиваем ручной ввод
  await setState(chatId, "reg_name_manual");
  await sendScreen(bot, chatId, user, { 
    text: TXT.start.greeting 
  });
}

// === Возраст ===
export async function regAskAge(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_age");
  await sendScreen(bot, chatId, user, { text: TXT.reg.askAge });
}
export async function handleRegAge(bot: TelegramBot, msg: Message, user: DbUser) {
  if (!msg.text) return;
  const ageText = msg.text.trim();
  const age = Number(ageText);
  
  // Проверяем на NaN, целое число и диапазон
  if (isNaN(age) || !Number.isInteger(age) || age < 18 || age > 80) {
    await sendScreen(bot, msg.chat.id, user, { 
      text: TXT.validation.ageInvalid
    });
    return;
  }
  
  await query(`UPDATE users SET age = $2, updated_at = now() WHERE tg_id = $1`, [msg.chat.id, age]);
  await regAskGender(bot, msg.chat.id, user);
}

// === Пол/кого ищешь ===
export async function regAskGender(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_gender");
  await sendScreen(bot, chatId, user, { text: TXT.reg.askGender, keyboard: Keyboards.regGender() });
}
export async function regAskSeek(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_seek");
  await sendScreen(bot, chatId, user, { text: TXT.reg.askSeek, keyboard: Keyboards.regSeek() });
}

// === Город ===

export async function regAskCity(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_city");
  const replyKb: ReplyKeyboardMarkup = {
    keyboard: [
      [ { text: TXT.reg.cityShareBtn, request_location: true } as KeyboardButton ],
      [ { text: TXT.reg.cityManualBtn } ]
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
  await sendScreen(bot, chatId, user, { text: TXT.reg.askCity, reply_markup: replyKb });
}


/** Показать экран подтверждения города через reply-кнопку с подсказкой. */
async function askCityTextWithSuggest(
  bot: TelegramBot,
  chatId: number,
  user: DbUser,
  suggest?: string | null
) {
  await setState(chatId, "reg_city_text");
  const lines = [
    suggest ? TXT.city.confirmSuggest.replace('{city}', suggest) : TXT.city.confirmManual,
    TXT.city.inputHint,
  ];
  const replyKb: ReplyKeyboardMarkup = {
    keyboard: suggest ? [[{ text: suggest }]] : [[{ text: TXT.city.example }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
  await sendScreen(bot, chatId, user, {
    text: lines.join("\n"),
    parse_mode: "HTML",
    reply_markup: replyKb,
  });
}

/** Обработка шага "Город": локация -> подсказка; либо сразу текст. */
export async function handleRegCity(bot: TelegramBot, msg: Message, user: DbUser) {
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();

  // Пользователь ткнул "✏️ Ввести город текстом" — открываем ввод текста (reply с подсказкой уберём после ввода)
  if (text === TXT.reg.cityManualBtn) {
    await askCityTextWithSuggest(bot, chatId, user, undefined);
    return;
  }

  // 1) Пришла геолокация — сохраняем координаты и показываем подсказку города (НЕ сохраняем текст геокодера)
  if (msg.location) {
    const { latitude, longitude } = msg.location;

    await query(
      `UPDATE users
         SET geom = ST_SetSRID(ST_MakePoint($2,$3),4326),
             updated_at = now()
       WHERE tg_id = $1`,
      [chatId, longitude, latitude]
    );

    let suggest: string | null = null;
    try {
      const res = await reverseGeocode(latitude, longitude, "ru");
      const name = res.cityName && res.cityName.trim();
      if (name && name.length >= 2) suggest = name;
    } catch (error) {
      // Логируем ошибку, но не прерываем процесс регистрации
      console.warn("Geocoding failed:", error);
    }

    await askCityTextWithSuggest(bot, chatId, user, suggest);
    return;
  }

  // 2) Нет локации. Если текста нет (стикер/фото и т.п.) — повторим экран города с кнопками
  if (!text) {
    await regAskCity(bot, chatId, user);
    return;
  }

  // Если внезапно пришёл текст кнопки "📍 Поделиться геолокацией" — подскажем прислать локацию ещё раз
  if (text === TXT.reg.cityShareBtn) {
    await regAskCity(bot, chatId, user);
    return;
  }

  // 3) Это пользовательский ввод города — валидируем и сохраняем
  const city = text.replace(/\s+/g, " ").trim();
  if (!city || city.length < 2 || city.length > 80) {
    await sendScreen(bot, chatId, user, { 
      text: TXT.validation.cityInvalid
    });
    return;
  }

  await query(
    `UPDATE users
       SET city_name = $2,
           updated_at = now()
     WHERE tg_id = $1`,
    [chatId, city]
  );

  // Скрыть reply-клавиатуру «без мусора» и перейти к фото
  await hideReplyKeyboard(bot, chatId);
  await regAskPhoto(bot, chatId, user);
}


// === Имя ===
export async function regAskName(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_name");
  await sendScreen(bot, chatId, user, { text: "Как тебя называть? Введи имя/ник (2–32 символа)." });
}
export async function handleRegName(bot: TelegramBot, msg: Message, user: DbUser) {
  const chatId = msg.chat.id;
  const name = (msg.text || "").trim();
  
  // Используем новую валидацию
  const validation = validateName(name);
  if (!validation.valid) {
    await sendScreen(bot, chatId, user, { 
      text: validation.error || TXT.validation.nameGeneric
    });
    return;
  }
  
  await query(`UPDATE users SET name=$2, updated_at=now() WHERE tg_id=$1`, [chatId, name]);
  await regAskAbout(bot, chatId, user);
}

// Обработчик ручного ввода имени при старте
export async function handleRegNameManual(bot: TelegramBot, msg: Message, user: DbUser) {
  const chatId = msg.chat.id;
  const name = (msg.text || "").trim();
  
  // Используем новую валидацию
  const validation = validateName(name);
  if (!validation.valid) {
    await sendScreen(bot, chatId, user, { 
      text: validation.error || TXT.validation.nameGeneric
    });
    return;
  }
  
  // Сохраняем имя и переходим к возрасту
  await query(`UPDATE users SET name=$2, updated_at=now() WHERE tg_id=$1`, [chatId, name]);
  await sendScreen(bot, chatId, user, { 
    text: TXT.start.welcome.replace('{name}', name)
  });
  await regAskAge(bot, chatId, user);
}

// === Начало перерегистрации с имени ===
export async function startRestartWithName(bot: TelegramBot, chatId: number, user: DbUser, firstName?: string) {
  // Сбрасываем данные пользователя
  await query(`DELETE FROM photos WHERE user_id=$1`, [chatId]);
  await query(`
    UPDATE users
    SET name=NULL, age=NULL, gender=NULL, seek=NULL,
        city_name=NULL, geom=NULL, about=NULL,
        status='new', state=NULL, updated_at=now()
    WHERE tg_id=$1
  `, [chatId]);

  // Начинаем с обработки имени
  await handleStartName(bot, chatId, user, firstName);
}

// === О себе (опц.) ===
export async function regAskAbout(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_about");
  const text = "Расскажи о себе (до 300 символов) или нажми «Пропустить».";
  await sendScreen(bot, chatId, user, { text, keyboard: [[{ text: "Пропустить", callback_data: mkCb(CB.REG, "about_skip") }]] });
}
export async function handleRegAbout(bot: TelegramBot, msg: Message, user: DbUser) {
  const chatId = msg.chat.id;
  const about = (msg.text || "").trim();
  
  // Проверяем длину (0 символов разрешено - пользователь может пропустить)
  if (about.length > 300) {
    await sendScreen(bot, chatId, user, { 
      text: "Слишком длинно. До 300 символов, пожалуйста."
    });
    return;
  }
  
  // Сохраняем только если есть текст
  if (about.length > 0) {
    await query(`UPDATE users SET about=$2, updated_at=now() WHERE tg_id=$1`, [chatId, about]);
  }
  
  await regAskPhoto(bot, chatId, user);
}

// === Фото ===
function buildRegPhotoText(loaded: number): string {
  return [
    `Отправь 1–5 фото. Загружено: ${loaded}/5.`,
    `Или нажми «📥 Импорт из профиля».`,
    ``,
    `ℹ️ Импортирует только <b>видимые боту</b> фото профиля:`,
    `• Если в Telegram → Настройки → Конфиденциальность → Фото профиля ≠ «Все», бот фото не увидит;`,
    `• Видео-аватар <b>не</b> импортируется — только обычные фото;`,
    `• Импортируем максимум 5 фото.`,
  ].join("\n");
}

export async function regAskPhoto(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_photo_method");
  const r = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
  const c = r.rows[0]?.c ?? 0;
  await sendScreen(bot, chatId, user, { text: buildRegPhotoText(c), keyboard: Keyboards.regPhotoMethod() });
}

// Обработка выбора способа загрузки фото
export async function regPhotoMethod(bot: TelegramBot, chatId: number, user: DbUser, method: string) {
  if (method === "import") {
    await regPhotoImport(bot, chatId, user);
  } else if (method === "upload") {
    await regPhotoUpload(bot, chatId, user);
  }
}

// Возврат к выбору способа загрузки
export async function regPhotoMethodBack(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_photo_method");
  const r = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
  const c = r.rows[0]?.c ?? 0;
  
  // Используем sendScreen для корректного отображения
  await sendScreen(bot, chatId, user, { 
    text: buildRegPhotoText(c), 
    keyboard: Keyboards.regPhotoMethod() 
  });
}

// Показать карусель фото
export async function regShowPhotoCarousel(bot: TelegramBot, chatId: number, user: DbUser, source: "imported" | "uploaded" = "uploaded") {
  await setState(chatId, "reg_photo_carousel");
  
  const photos = await getAllUserPhotos(chatId);
  if (photos.length === 0) {
    await regShowNoPhoto(bot, chatId, user);
    return;
  }
  
  const currentIndex = 0;
  const caption = source === "imported" 
    ? `📥 Импортировано ${photos.length} фото из профиля\n\nПросмотрите фото и нажмите "Готово" для продолжения.`
    : `📤 Загружено ${photos.length} фото\n\nПросмотрите фото и нажмите "Готово" для продолжения.`;
  
  // Используем sendScreen для корректного управления сообщениями
  await sendScreen(bot, chatId, user, {
    photoFileId: photos[currentIndex],
    caption,
    keyboard: Keyboards.regPhotoCarousel(photos.length, currentIndex)
  });
}

// Показать экран без фото
export async function regShowNoPhoto(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_no_photo");
  
  const text = `👤 Профиль без фото\n\nВы можете продолжить регистрацию без фото или вернуться к выбору способа загрузки.`;
  
  // Используем sendScreen для корректного управления сообщениями
  await sendScreen(bot, chatId, user, {
    text,
    keyboard: Keyboards.regNoPhoto()
  });
}

// Показать предпросмотр импорта фото
export async function regShowImportPreview(bot: TelegramBot, chatId: number, user: DbUser, profilePhotos: string[]) {
  await setState(chatId, "reg_photo_import_preview");
  
  const currentIndex = 0;
  const caption = `📥 Найдено ${profilePhotos.length} фото в вашем профиле\n\nПросмотрите фото и нажмите "Готово" для добавления в профиль.`;
  
  // Используем sendScreen для корректного управления сообщениями
  await sendScreen(bot, chatId, user, {
    photoFileId: profilePhotos[currentIndex],
    caption,
    keyboard: Keyboards.regPhotoCarousel(profilePhotos.length, currentIndex)
  });
}

// Навигация по предпросмотру импорта
export async function regImportPreviewNav(bot: TelegramBot, chatId: number, user: DbUser, index: number) {
  // Получаем фото из профиля заново для навигации
  const cur = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
  const currentCount = cur.rows[0]?.c ?? 0;
  const availableSlots = 5 - currentCount;
  const profilePhotos = await getTelegramProfilePhotosForPreview(bot, chatId, availableSlots);
  
  if (profilePhotos.length === 0) {
    await regShowNoPhoto(bot, chatId, user);
    return;
  }
  
  const safeIndex = ((Number.isFinite(index) ? index : 0) % profilePhotos.length + profilePhotos.length) % profilePhotos.length;
  const caption = `📥 Найдено ${profilePhotos.length} фото в вашем профиле\n\nПросмотрите фото и нажмите "Готово" для добавления в профиль.`;
  
  try {
    await bot.editMessageMedia({
      type: "photo",
      media: profilePhotos[safeIndex],
      caption,
      parse_mode: "HTML"
    }, {
      chat_id: chatId,
      message_id: user.last_screen_msg_id || undefined,
      reply_markup: { inline_keyboard: Keyboards.regPhotoCarousel(profilePhotos.length, safeIndex) }
    });
    return; // Успешно обновили, выходим
  } catch (error) {
    // Если не удалось обновить, удаляем старое сообщение и отправляем новое
    if (user.last_screen_msg_id) {
      try {
        await bot.deleteMessage(chatId, user.last_screen_msg_id);
      } catch (deleteError) {
        // Игнорируем ошибки удаления
      }
    }
    
    // Используем sendScreen для корректного управления сообщениями
    await sendScreen(bot, chatId, user, {
      photoFileId: profilePhotos[safeIndex],
      caption,
      keyboard: Keyboards.regPhotoCarousel(profilePhotos.length, safeIndex)
    });
  }
}

// Импортировать фото при нажатии "Готово"
export async function regImportPhotos(bot: TelegramBot, chatId: number, user: DbUser) {
  const cur = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
  const currentCount = cur.rows[0]?.c ?? 0;
  const availableSlots = 5 - currentCount;
  
  // Импортируем фото в базу
  const imported = await importPhotosFromTelegramProfile(bot, chatId, { 
    replace: false, 
    limit: availableSlots 
  });
  
  if (imported > 0) {
    // После успешного импорта сразу завершаем регистрацию
    await regConfirm(bot, chatId, user);
  } else {
    // Если не удалось импортировать, завершаем регистрацию
    await regConfirm(bot, chatId, user);
  }
}

// Показать предпросмотр загруженных фото
export async function regShowUploadPreview(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_photo_upload_preview");
  
  const photos = getSessionPhotos(chatId);
  console.log(`[DEBUG] regShowUploadPreview: chatId=${chatId}, photos.length=${photos.length}, photos=${JSON.stringify(photos)}`);
  
  if (photos.length === 0) {
    await sendScreen(bot, chatId, user, { 
      text: "Нет загруженных фото. Попробуйте загрузить фото снова.",
      keyboard: Keyboards.regPhotoUpload()
    });
    return;
  }
  
  const currentIndex = 0;
  const caption = `📤 Загружено ${photos.length} фото\n\nВот как будет выглядеть ваш профиль. Просмотрите фото и нажмите "Готово" для завершения.\n\n📸 Фото 1 из ${photos.length}`;
  
  // Используем sendScreen для корректного управления сообщениями
  await sendScreen(bot, chatId, user, {
    photoFileId: photos[currentIndex],
    caption,
    keyboard: Keyboards.regPhotoCarousel(photos.length, currentIndex)
  });
}


// Навигация по предпросмотру загруженных фото
export async function regUploadPreviewNav(bot: TelegramBot, chatId: number, user: DbUser, index: number) {
  const photos = getSessionPhotos(chatId);
  console.log(`[DEBUG] regUploadPreviewNav: chatId=${chatId}, photos.length=${photos.length}, photos=${JSON.stringify(photos)}`);
  
  if (photos.length === 0) {
    await sendScreen(bot, chatId, user, { 
      text: "Нет загруженных фото.",
      keyboard: Keyboards.regPhotoUpload()
    });
    return;
  }
  
  const safeIndex = ((Number.isFinite(index) ? index : 0) % photos.length + photos.length) % photos.length;
  
  // Обновляем сообщение с новым фото
  try {
    await bot.editMessageMedia({
      type: "photo",
      media: photos[safeIndex],
      caption: `📤 Загружено ${photos.length} фото\n\nВот как будет выглядеть ваш профиль. Просмотрите фото и нажмите "Готово" для завершения.\n\n📸 Фото ${safeIndex + 1} из ${photos.length}`,
      parse_mode: "HTML"
    }, {
      chat_id: chatId,
      message_id: user.last_screen_msg_id || undefined,
      reply_markup: { inline_keyboard: Keyboards.regPhotoCarousel(photos.length, safeIndex) }
    });
    return; // Успешно обновили, выходим
  } catch (error) {
    // Если не удалось обновить, удаляем старое сообщение и отправляем новое
    if (user.last_screen_msg_id) {
      try {
        await bot.deleteMessage(chatId, user.last_screen_msg_id);
      } catch (deleteError) {
        // Игнорируем ошибки удаления
      }
    }
    
    // Используем sendScreen для корректного управления сообщениями
    await sendScreen(bot, chatId, user, {
      photoFileId: photos[safeIndex],
      caption: `📤 Загружено ${photos.length} фото\n\nВот как будет выглядеть ваш профиль. Просмотрите фото и нажмите "Готово" для завершения.\n\n📸 Фото ${safeIndex + 1} из ${photos.length}`,
      keyboard: Keyboards.regPhotoCarousel(photos.length, safeIndex)
    });
  }
}

// Сохранить загруженные фото в профиль
export async function regSaveUploadedPhotos(bot: TelegramBot, chatId: number, user: DbUser) {
  const photos = getSessionPhotos(chatId);
  if (photos.length === 0) {
    await regConfirm(bot, chatId, user);
    return;
  }
  
  // Проверяем лимит в базе
  const cur = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
  const currentCount = cur.rows[0]?.c ?? 0;
  const availableSlots = 5 - currentCount;
  
  if (availableSlots <= 0) {
    await sendScreen(bot, chatId, user, { 
      text: "У вас уже максимальное количество фото в профиле.",
      keyboard: Keyboards.regPhotoMethod()
    });
    clearUploadSession(chatId);
    await regConfirm(bot, chatId, user);
    return;
  }
  
  // Сохраняем фото в базу (не больше доступных слотов)
  const photosToSave = photos.slice(0, availableSlots);
  let savedCount = 0;
  
  for (const fileId of photosToSave) {
    try {
      await addPhotoSafely(chatId, fileId);
      savedCount++;
    } catch (error) {
      console.error("Error saving photo:", error);
    }
  }
  
  // Очищаем сессию
  clearUploadSession(chatId);
  
  if (savedCount > 0) {
    // После успешного сохранения сразу завершаем регистрацию
    await regConfirm(bot, chatId, user);
  } else {
    // Если не удалось сохранить, завершаем регистрацию
    await regConfirm(bot, chatId, user);
  }
}

// Навигация по карусели фото
export async function regPhotoCarouselNav(bot: TelegramBot, chatId: number, user: DbUser, index: number) {
  const photos = await getAllUserPhotos(chatId);
  if (photos.length === 0) {
    await regShowNoPhoto(bot, chatId, user);
    return;
  }
  
  const safeIndex = ((Number.isFinite(index) ? index : 0) % photos.length + photos.length) % photos.length;
  const caption = `📸 Просмотр фото ${safeIndex + 1}/${photos.length}\n\nПросмотрите фото и нажмите "Готово" для продолжения.`;
  
  try {
    await bot.editMessageMedia({
      type: "photo",
      media: photos[safeIndex],
      caption,
      parse_mode: "HTML"
    }, {
      chat_id: chatId,
      message_id: user.last_screen_msg_id || undefined,
      reply_markup: { inline_keyboard: Keyboards.regPhotoCarousel(photos.length, safeIndex) }
    });
    return; // Успешно обновили, выходим
  } catch (error) {
    // Если не удалось обновить, удаляем старое сообщение и отправляем новое
    if (user.last_screen_msg_id) {
      try {
        await bot.deleteMessage(chatId, user.last_screen_msg_id);
      } catch (deleteError) {
        // Игнорируем ошибки удаления
      }
    }
    
    // Используем sendScreen для корректного управления сообщениями
    await sendScreen(bot, chatId, user, {
      photoFileId: photos[safeIndex],
      caption,
      keyboard: Keyboards.regPhotoCarousel(photos.length, safeIndex)
    });
  }
}

// Импорт фото из профиля - предпросмотр
export async function regPhotoImport(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_photo_import_preview");
  
  const cur = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
  const currentCount = cur.rows[0]?.c ?? 0;
  
  if (currentCount >= 5) {
    await sendScreen(bot, chatId, user, {
      text: "У вас уже максимальное количество фото (5/5).",
      keyboard: Keyboards.regPhotoMethod()
    });
    return;
  }
  
  // Получаем фото из профиля для предпросмотра (без импорта в базу)
  const availableSlots = 5 - currentCount;
  const profilePhotos = await getTelegramProfilePhotosForPreview(bot, chatId, availableSlots);
  
  if (profilePhotos.length === 0) {
    await sendScreen(bot, chatId, user, {
      text: "Не удалось найти фото в вашем профиле Telegram.\n\nПопробуйте загрузить фото вручную или продолжить без фото.",
      keyboard: Keyboards.regNoPhoto()
    });
    return;
  }
  
  // Показываем предпросмотр фото из профиля
  await regShowImportPreview(bot, chatId, user, profilePhotos);
}

// Начать загрузку фото
export async function regPhotoUpload(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_photo_upload");
  
  const r = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
  const c = r.rows[0]?.c ?? 0;
  
  if (c >= 5) {
    await sendScreen(bot, chatId, user, {
      text: "У вас уже максимальное количество фото (5/5).",
      keyboard: Keyboards.regPhotoMethod()
    });
    return;
  }
  
  // Создаем сессию загрузки
  const maxPhotos = 5; // Максимум 5 фото для загрузки
  createUploadSession(chatId, maxPhotos);
  
  // Обновляем существующее сообщение с инструкциями загрузки
  await sendScreen(bot, chatId, user, {
    text: `📤 Загрузите фото из галереи\n\nПожалуйста, выберите и отправьте одно или несколько фото (максимум ${maxPhotos}).`,
    keyboard: Keyboards.regPhotoUpload()
  });
}

export async function handleRegPhotoMessage(bot: TelegramBot, msg: Message, user: DbUser) {
  const chatId = msg.chat.id;
  
  // Проверяем, что пользователь в правильном состоянии для загрузки фото
  if (user.state !== "reg_photo_upload") {
    await sendScreen(bot, chatId, user, { 
      text: "Сначала выберите способ загрузки фото.",
      keyboard: Keyboards.regPhotoMethod()
    });
    return;
  }
  
  if (!msg.photo || msg.photo.length === 0) {
    await sendScreen(bot, chatId, user, { 
      text: "Пожалуйста, отправьте только фотографии.",
      keyboard: Keyboards.regPhotoUpload()
    });
    return;
  }
  
  // Получаем лучший размер фото
  const bestPhoto = getBestPhotoSize(msg.photo);
  if (!bestPhoto) {
    await sendScreen(bot, chatId, user, { 
      text: "Не удалось обработать фото. Попробуйте другое.",
      keyboard: Keyboards.regPhotoUpload()
    });
    return;
  }
  
  // Валидируем фото
  const validation = validatePhoto(bestPhoto);
  if (!validation.valid) {
    await sendScreen(bot, chatId, user, { 
      text: validation.error || "Фото не прошло валидацию.",
      keyboard: Keyboards.regPhotoUpload()
    });
    return;
  }
  
  // Проверяем, можно ли добавить еще фото
  if (!canAddMorePhotos(chatId)) {
    await sendScreen(bot, chatId, user, { 
      text: "Максимальное количество фото: 5. Выберите самые лучшие!",
      keyboard: Keyboards.regPhotoUpload()
    });
    return;
  }
  
  // Добавляем фото в сессию
  const result = addPhotoToSession(chatId, bestPhoto.file_id);
  console.log(`[DEBUG] handleRegPhotoMessage: chatId=${chatId}, addPhoto result=${JSON.stringify(result)}`);
  
  if (!result.success) {
    await sendScreen(bot, chatId, user, { 
      text: result.error || "Не удалось добавить фото.",
      keyboard: Keyboards.regPhotoUpload()
    });
    return;
  }
  
  // Проверяем сессию после добавления
  const photosAfterAdd = getSessionPhotos(chatId);
  console.log(`[DEBUG] handleRegPhotoMessage: after add, photos.length=${photosAfterAdd.length}, photos=${JSON.stringify(photosAfterAdd)}`);
  
  // Проверяем, не обрабатывается ли уже фото
  if (isProcessing(chatId)) {
    // Если уже обрабатывается, просто выходим - UI обновится после завершения текущей обработки
    return;
  }
  
  // Устанавливаем флаг обработки
  setProcessingFlag(chatId, true);
  
  try {
    // Небольшая задержка для обработки возможных дополнительных фото
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Получаем свежие данные пользователя для корректного last_screen_msg_id
    const freshUser = await query(`
      SELECT tg_id::text, username, name, state, last_screen_msg_id::text, last_screen_at::text, status
      FROM users WHERE tg_id = $1
    `, [chatId]);
    
    const updatedUser = freshUser.rows[0];
    
    // Показываем или обновляем предпросмотр загруженных фото
    // sendScreen сам управляет удалением старых сообщений
    await regShowUploadPreview(bot, chatId, updatedUser as DbUser);
    
  } finally {
    // Сбрасываем флаг обработки
    setProcessingFlag(chatId, false);
  }
}

// === Предпросмотр/подтверждение ===
export async function regShowPreview(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_preview");
  const { buildProfileCaption, getMainPhotoFileId } = await import("./profile");
  const caption = await buildProfileCaption(chatId);
  const mainPhoto = await getMainPhotoFileId(chatId);
  if (!mainPhoto) {
    await regAskPhoto(bot, chatId, user);
    return;
  }
  await sendScreen(bot, chatId, user, {
    photoFileId: mainPhoto, 
    caption,
    parse_mode: "HTML",
    keyboard: [
      [{ text: "✅ Подтвердить",    callback_data: mkCb(CB.REG, "confirm") }],
      [{ text: "📷 Изменить фото",  callback_data: mkCb(CB.REG, "photo_again") }],
    ],
  });
}

export async function regConfirm(bot: TelegramBot, chatId: number, user: DbUser) {
  await query(`UPDATE users SET status='active', state='idle', updated_at=now() WHERE tg_id=$1`, [chatId]);
  await showProfile(bot, chatId, user);
}
