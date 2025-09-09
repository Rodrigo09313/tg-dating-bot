// src/ui/buttons.ts
import { InlineKeyboardButton } from "node-telegram-bot-api";
import { TXT } from "./text";
import { mkCb } from "./cb";
import { CB } from "../types";

export const kb = {
  menu(): InlineKeyboardButton[][] {
    return [
      [{ text: TXT.btn.roulette, callback_data: mkCb(CB.RL, "find") }],
      [{ text: TXT.btn.browse,   callback_data: mkCb(CB.BRW, "start") }],
      [{ text: TXT.btn.profile,  callback_data: mkCb(CB.PRF, "open") }],
      [{ text: TXT.btn.help,     callback_data: mkCb(CB.SYS, "help") }],
    ];
  },

  // Профиль — базовые 5 кнопок (порядок фиксирован ТЗ)
  profile(): InlineKeyboardButton[][] {
    return [
      [{ text: TXT.profileBtns.roulette, callback_data: mkCb(CB.RL, "find") }],
      [{ text: TXT.profileBtns.browse,   callback_data: mkCb(CB.BRW, "start") }],
      [{ text: TXT.profileBtns.photo,    callback_data: mkCb(CB.PRF, "photo") }],
      [{ text: TXT.profileBtns.about,    callback_data: mkCb(CB.PRF, "about") }],
      [{ text: TXT.profileBtns.restart,  callback_data: mkCb(CB.PRF, "restart_confirm") }],
    ];
  },

  // Профиль — та же клавиатура, но с верхней строкой навигации по фото (◀ i/n ▶)
  profileWithNav(total: number, currentIndex: number): InlineKeyboardButton[][] {
    const base = this.profile();
    if (total <= 1) return base;

    // вычислим соседние индексы (круговая навигация)
    const prev = (currentIndex - 1 + total) % total;
    const next = (currentIndex + 1) % total;

    const navRow: InlineKeyboardButton[] = [
      { text: "◀", callback_data: mkCb(CB.PRF, "phnav", prev) },
      { text: `${currentIndex + 1}/${total}`, callback_data: mkCb(CB.PRF, "noop") },
      { text: "▶", callback_data: mkCb(CB.PRF, "phnav", next) },
    ];
    // Навигация — сверху, далее 5 фиксированных кнопок профиля
    return [navRow, ...base];
  },

  regGender(): InlineKeyboardButton[][] {
    return [
      [{ text: "Мужчина", callback_data: mkCb(CB.REG, "gender", "m") }],
      [{ text: "Женщина", callback_data: mkCb(CB.REG, "gender", "f") }],
    ];
  },

  regSeek(): InlineKeyboardButton[][] {
    return [
      [{ text: "Ищу мужчин",  callback_data: mkCb(CB.REG, "seek", "m") }],
      [{ text: "Ищу женщин",  callback_data: mkCb(CB.REG, "seek", "f") }],
      [{ text: "Обоих",       callback_data: mkCb(CB.REG, "seek", "b") }],
    ];
  },

  // Регистрация: базовые действия на шаге фото
  regPhotoActions(): InlineKeyboardButton[][] {
    return [
      [{ text: "📥 Импорт из профиля", callback_data: mkCb(CB.REG, "photo_import") }],
      [{ text: "✅ Готово",            callback_data: mkCb(CB.REG, "photo_done") }],
    ];
  },

  // Регистрация: ретрай импорта под сообщением об ошибке
  regPhotoRetryActions(): InlineKeyboardButton[][] {
    return [
      [{ text: "🔄 Повторить импорт", callback_data: mkCb(CB.REG, "photo_import") }],
      [{ text: "✅ Готово",           callback_data: mkCb(CB.REG, "photo_done") }],
    ];
  },

  // Профиль: действия при редактировании фото
  prfPhotoActions(): InlineKeyboardButton[][] {
    return [
      [{ text: "📥 Импорт из профиля", callback_data: mkCb(CB.PRF, "photo_import") }],
      [{ text: "✅ Готово",            callback_data: mkCb(CB.PRF, "photo_done") }],
    ];
  },

  // Профиль: ретрай импорта при ошибке
  prfPhotoRetryActions(): InlineKeyboardButton[][] {
    return [
      [{ text: "🔄 Повторить импорт", callback_data: mkCb(CB.PRF, "photo_import") }],
      [{ text: "✅ Готово",           callback_data: mkCb(CB.PRF, "photo_done") }],
    ];
  },

  browseCard(candidateId: number): InlineKeyboardButton[][] {
    return [
      [{ text: "➡️ Следующая",    callback_data: mkCb(CB.BRW, "next") }],
      [{ text: "✉️ Написать",     callback_data: mkCb(CB.CR,  "req", candidateId) }],
      [{ text: "🚩 Пожаловаться", callback_data: mkCb(CB.REP, "card", candidateId) }],
    ];
  },

  requestIncoming(crId: number): InlineKeyboardButton[][] {
    return [
      [
        { text: "✅ Принять",  callback_data: mkCb(CB.CR, "accept", crId) },
        { text: "❌ Отклонить", callback_data: mkCb(CB.CR, "decline", crId) },
      ],
      [{ text: "🚩 Пожаловаться", callback_data: mkCb(CB.REP, "request", crId) }],
    ];
  },
};
