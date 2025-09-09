// src/bot/registration.ts
import TelegramBot, { Message, ReplyKeyboardMarkup, KeyboardButton } from "node-telegram-bot-api";
import { query } from "../db";
import { DbUser, sendScreen, setState } from "./helpers";
import { TXT } from "../ui/text";
import { kb } from "../ui/buttons";
import { showProfile } from "./profile";
import { importPhotosFromTelegramProfile, addPhotoSafely } from "./photo";
import { reverseGeocode } from "../lib/geocode";
import { hideReplyKeyboard } from "../lib/hideReply";

// === Возраст ===
export async function regAskAge(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_age");
  await sendScreen(bot, chatId, user, { text: TXT.reg.askAge });
}
export async function handleRegAge(bot: TelegramBot, msg: Message, user: DbUser) {
  if (!msg.text) return;
  const age = Number(msg.text.trim());
  if (!Number.isInteger(age) || age < 18 || age > 80) {
    await bot.sendMessage(msg.chat.id, "Введите корректный возраст (18–80).");
    return;
  }
  await query(`UPDATE users SET age = $2, updated_at = now() WHERE tg_id = $1`, [msg.chat.id, age]);
  await regAskGender(bot, msg.chat.id, user);
}

// === Пол/кого ищешь ===
export async function regAskGender(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_gender");
  await sendScreen(bot, chatId, user, { text: TXT.reg.askGender, keyboard: kb.regGender() });
}
export async function regAskSeek(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_seek");
  await sendScreen(bot, chatId, user, { text: TXT.reg.askSeek, keyboard: kb.regSeek() });
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
  await bot.sendMessage(chatId, TXT.reg.askCity, { reply_markup: replyKb });
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
    suggest ? `Похоже, это <b>${suggest}</b>.` : "Подтверди или исправь город.",
    "Нажми кнопку ниже или напиши город текстом.\nПример: «Москва».",
  ];
  const replyKb: ReplyKeyboardMarkup = {
    keyboard: suggest ? [[{ text: suggest }]] : [[{ text: "Москва" }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
  await bot.sendMessage(chatId, lines.join("\n"), {
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
    } catch {}

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
  if (city.length < 2 || city.length > 80) {
    await bot.sendMessage(chatId, "Введите корректное название города (2–80 символов).");
    return;
  }

  await query(
    `UPDATE users
       SET city_name = $2,
           updated_at = now()
     WHERE tg_id = $1`,
    [chatId, city]
  );

  // Скрыть reply-клавиатуру «без мусора» и перейти к имени
  await hideReplyKeyboard(bot, chatId);
  await regAskName(bot, chatId, user);
}


// === Имя ===
export async function regAskName(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_name");
  await sendScreen(bot, chatId, user, { text: "Как тебя называть? Введи имя/ник (2–32 символа)." });
}
export async function handleRegName(bot: TelegramBot, msg: Message, user: DbUser) {
  const chatId = msg.chat.id;
  const name = (msg.text || "").trim();
  if (name.length < 2 || name.length > 32) {
    await bot.sendMessage(chatId, "Длина имени должна быть 2–32 символа.");
    return;
  }
  await query(`UPDATE users SET name=$2, updated_at=now() WHERE tg_id=$1`, [chatId, name]);
  await regAskAbout(bot, chatId, user);
}

// === О себе (опц.) ===
export async function regAskAbout(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_about");
  const text = "Расскажи о себе (до 300 символов) или нажми «Пропустить».";
  await sendScreen(bot, chatId, user, { text, keyboard: [[{ text: "Пропустить", callback_data: "reg:about_skip" }]] });
}
export async function handleRegAbout(bot: TelegramBot, msg: Message, user: DbUser) {
  const chatId = msg.chat.id;
  const about = (msg.text || "").trim();
  if (about.length > 300) {
    await bot.sendMessage(chatId, "Слишком длинно. До 300 символов, пожалуйста.");
    return;
  }
  if (about.length > 0) {
    await query(`UPDATE users SET about=$2, updated_at=now() WHERE tg_id=$1`, [chatId, about]);
  }
  await regAskPhoto(bot, chatId, user);
}

// === Фото ===
function buildRegPhotoText(loaded: number): string {
  return [
    `Отправь 1–3 фото. Загружено: ${loaded}/3.`,
    `Или нажми «📥 Импорт из профиля».`,
    ``,
    `ℹ️ Импортирует только <b>видимые боту</b> фото профиля:`,
    `• Если в Telegram → Настройки → Конфиденциальность → Фото профиля ≠ «Все», бот фото не увидит;`,
    `• Видео-аватар <b>не</b> импортируется — только обычные фото;`,
    `• Импортируем максимум 3 фото.`,
  ].join("\n");
}

export async function regAskPhoto(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "reg_photo");
  const cur = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
  if ((cur.rows[0]?.c ?? 0) === 0) {
    const imported = await importPhotosFromTelegramProfile(bot, chatId, { replace: false, limit: 3 });
    if (imported > 0) {
      await regShowPreview(bot, chatId, user);
      return;
    }
  }
  const r = await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM photos WHERE user_id=$1`, [chatId]);
  const c = r.rows[0]?.c ?? 0;
  await sendScreen(bot, chatId, user, { text: buildRegPhotoText(c), keyboard: kb.regPhotoActions() });
}

export async function handleRegPhotoMessage(bot: TelegramBot, msg: Message, user: DbUser) {
  const chatId = msg.chat.id;
  const best = (msg.photo || []).slice(-1)[0];
  if (!best) return;
  try {
    const { total } = await addPhotoSafely(chatId, best.file_id);
    await bot.sendMessage(chatId, `Фото добавлено (${total}/3).`, {
      reply_markup: { inline_keyboard: [[{ text: "✅ Готово", callback_data: "reg:photo_done" }]] }
    });
  } catch (e: any) {
    if (e && String(e.message).includes("LIMIT_REACHED")) {
      await bot.sendMessage(chatId, "Максимум 3 фото. Нажми «Готово» или «Импорт из профиля».");
    } else {
      await bot.sendMessage(chatId, "Не удалось сохранить фото. Попробуйте ещё раз.");
    }
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
    photoFileId: mainPhoto, caption,
    keyboard: [
      [{ text: "✅ Подтвердить",    callback_data: "reg:confirm" }],
      [{ text: "📷 Изменить фото",  callback_data: "reg:photo_again" }],
    ],
  });
}

export async function regConfirm(bot: TelegramBot, chatId: number, user: DbUser) {
  await query(`UPDATE users SET status='active', state='idle', updated_at=now() WHERE tg_id=$1`, [chatId]);
  await showProfile(bot, chatId, user);
}
