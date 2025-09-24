// src/ui/keyboards.ts
// Единая система управления всеми клавиатурами и кнопками

import { InlineKeyboardButton } from "node-telegram-bot-api";
import { mkCb } from "./cb";
import { CB } from "../types";

// ===== КОНСТАНТЫ КНОПОК =====
export const BUTTONS = {
  // Основные действия
  FIND_PAIR: "💞 Найти пару",
  FAVORITES: "⭐ Избранное", 
  REQUESTS: "💌 Мои запросы",
  ACCEPTED: "✅ Принятые",
  DECLINED: "❌ Отклонённые",
  PROFILE: "👤 Профиль",
  CONTACTS: "👥 Контакты",
  HELP: "❓ Помощь",
  MENU: "🏠 В меню",
  
  // Регистрация
  MALE: "👨 Мужчина",
  FEMALE: "👩 Женщина", 
  SEEK_MALE: "👨 Мужчин",
  SEEK_FEMALE: "👩 Женщин",
  SEEK_ALL: "👥 Всех",
  SKIP: "Пропустить",
  
  // Фото
  IMPORT_PHOTOS: "📥 Импорт фото",
  DONE: "✅ Готово",
  CONFIRM: "✅ Подтвердить",
  RETRY: "🔄 Повторить",
  CHANGE_PHOTO: "📷 Изменить фото",
  
  // Навигация
  NEXT: "💞 Следующий",
  WRITE: "💌 Написать", 
  ADD_FAVORITE: "⭐ В избранное",
  REPORT: "🚩 Пожаловаться",
  
  // Запросы
  ACCEPT: "✅ Принять",
  DECLINE: "❌ Отклонить",
  
  // Рулетка
  ROULETTE: "🎲 Чат рулетка",
  STOP_SEARCH: "❌ Отменить поиск",
  STOP_CHAT: "❌ Завершить чат",
  
  // Профиль
  EDIT_PROFILE: "✏️ Редактировать профиль",
  PHOTOS: "🖼️ Мои фото",
  ABOUT: "📝 О себе", 
  RESTART: "🔄 Пересоздать",
  RESTART_CONFIRM: "✅ Да, сбросить",
  CANCEL: "❌ Отмена",
  
  // Дополнительные
  AGAIN: "🔄 Ещё раз",
  FIND_MORE: "💞 Найти ещё",
} as const;

// ===== ОСНОВНЫЕ КЛАВИАТУРЫ =====
export const Keyboards = {
  // Главное меню
  mainMenu(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.ROULETTE, callback_data: mkCb(CB.RL, "find") }],
      [{ text: BUTTONS.FIND_PAIR, callback_data: mkCb(CB.BRW, "start") }],
      [
        { text: BUTTONS.PROFILE, callback_data: mkCb(CB.PRF, "open") },
        { text: BUTTONS.HELP, callback_data: mkCb(CB.SYS, "help") }
      ]
    ];
  },

  // Профиль
  profile(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.CONTACTS, callback_data: mkCb(CB.PRF, "contacts") }],
      [{ text: BUTTONS.EDIT_PROFILE, callback_data: mkCb(CB.PRF, "edit") }],
      [{ text: BUTTONS.MENU, callback_data: mkCb(CB.SYS, "menu") }]
    ];
  },

  // Меню раздела контактов
  contactsMenu(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.FAVORITES, callback_data: mkCb(CB.FAV, "list") }],
      [{ text: BUTTONS.REQUESTS,  callback_data: mkCb(CB.CR,  "list") }],
      [{ text: BUTTONS.ACCEPTED,  callback_data: mkCb(CB.CR,  "accepted") }],
      [{ text: BUTTONS.DECLINED,  callback_data: mkCb(CB.CR,  "declined") }],
      [{ text: "◀️ Назад", callback_data: mkCb(CB.PRF, "open") }]
    ];
  },

  // Редактировать профиль
  editProfile(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.PHOTOS, callback_data: mkCb(CB.PRF, "photo") }],
      [{ text: BUTTONS.ABOUT, callback_data: mkCb(CB.PRF, "about") }],
      [{ text: BUTTONS.RESTART, callback_data: mkCb(CB.PRF, "restart_confirm") }],
      [{ text: BUTTONS.MENU, callback_data: mkCb(CB.PRF, "open") }]
    ];
  },

  // Профиль с навигацией по фото
  profileWithNav(total: number, currentIndex: number): InlineKeyboardButton[][] {
    const base = this.profile();
    if (total <= 1) return base;

    const prev = (currentIndex - 1 + total) % total;
    const next = (currentIndex + 1) % total;

    const navRow: InlineKeyboardButton[] = [
      { text: "◀️", callback_data: mkCb(CB.PRF, "phnav", prev) },
      { text: `📸 ${currentIndex + 1}/${total}`, callback_data: mkCb(CB.PRF, "noop") },
      { text: "▶️", callback_data: mkCb(CB.PRF, "phnav", next) },
    ];
    return [navRow, ...base];
  },

  // Регистрация - пол
  regGender(): InlineKeyboardButton[][] {
    return [
      [
        { text: BUTTONS.MALE, callback_data: mkCb(CB.REG, "gender", "m") },
        { text: BUTTONS.FEMALE, callback_data: mkCb(CB.REG, "gender", "f") }
      ]
    ];
  },

  // Регистрация - кого ищет
  regSeek(): InlineKeyboardButton[][] {
    return [
      [
        { text: BUTTONS.SEEK_MALE, callback_data: mkCb(CB.REG, "seek", "m") },
        { text: BUTTONS.SEEK_FEMALE, callback_data: mkCb(CB.REG, "seek", "f") }
      ],
      [
        { text: BUTTONS.SEEK_ALL, callback_data: mkCb(CB.REG, "seek", "b") }
      ]
    ];
  },

  // Регистрация - выбор способа загрузки фото
  regPhotoMethod(): InlineKeyboardButton[][] {
    return [
      [{ text: "📥 Импорт из профиля", callback_data: mkCb(CB.REG, "photo_import") }],
      [{ text: "📤 Загрузить фото", callback_data: mkCb(CB.REG, "photo_upload") }]
    ];
  },

  // Регистрация - фото (старая версия для совместимости)
  regPhotoActions(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.IMPORT_PHOTOS, callback_data: mkCb(CB.REG, "photo_import") }],
      [{ text: BUTTONS.DONE, callback_data: mkCb(CB.REG, "photo_done") }]
    ];
  },

  // Регистрация - загрузка фото
  regPhotoUpload(): InlineKeyboardButton[][] {
    return [
      [{ text: "◀️ Назад", callback_data: mkCb(CB.REG, "photo_method") }],
      [{ text: "✅ Готово", callback_data: mkCb(CB.REG, "photo_done") }]
    ];
  },

  // Регистрация - карусель фото с навигацией
  regPhotoCarousel(photoCount: number, currentIndex: number): InlineKeyboardButton[][] {
    if (photoCount <= 1) {
      return [
        [{ text: "◀️ Назад", callback_data: mkCb(CB.REG, "photo_method") }],
        [{ text: "✅ Готово", callback_data: mkCb(CB.REG, "photo_done") }]
      ];
    }

    const prev = (currentIndex - 1 + photoCount) % photoCount;
    const next = (currentIndex + 1) % photoCount;

    return [
      [
        { text: "◀️", callback_data: mkCb(CB.REG, "photo_nav", prev) },
        { text: `📸 ${currentIndex + 1}/${photoCount}`, callback_data: mkCb(CB.REG, "noop") },
        { text: "▶️", callback_data: mkCb(CB.REG, "photo_nav", next) }
      ],
      [
        { text: "◀️ Назад", callback_data: mkCb(CB.REG, "photo_method") },
        { text: "✅ Готово", callback_data: mkCb(CB.REG, "photo_done") }
      ]
    ];
  },

  // Регистрация - нет фото
  regNoPhoto(): InlineKeyboardButton[][] {
    return [
      [{ text: "◀️ Назад", callback_data: mkCb(CB.REG, "photo_method") }],
      [{ text: "✅ Готово", callback_data: mkCb(CB.REG, "photo_done") }]
    ];
  },

  regPhotoRetryActions(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.RETRY, callback_data: mkCb(CB.REG, "photo_import") }],
      [{ text: BUTTONS.DONE, callback_data: mkCb(CB.REG, "photo_done") }]
    ];
  },

  // Профиль - фото
  prfPhotoActions(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.IMPORT_PHOTOS, callback_data: mkCb(CB.PRF, "photo_import") }],
      [{ text: "📤 Загрузить фото", callback_data: mkCb(CB.PRF, "photo_upload") }],
      [{ text: BUTTONS.DONE, callback_data: mkCb(CB.PRF, "photo_done") }]
    ];
  },

  prfPhotoRetryActions(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.RETRY, callback_data: mkCb(CB.PRF, "photo_import") }],
      [{ text: BUTTONS.DONE, callback_data: mkCb(CB.PRF, "photo_done") }]
    ];
  },

  // Просмотр анкет
  browseCard(candidateId: number): InlineKeyboardButton[][] {
    return [
      [
        { text: BUTTONS.NEXT, callback_data: mkCb(CB.BRW, "next") },
        { text: BUTTONS.WRITE, callback_data: mkCb(CB.CR, "req", candidateId) }
      ],
      [
        { text: BUTTONS.REPORT, callback_data: mkCb(CB.REP, "card", candidateId) },
        { text: BUTTONS.ADD_FAVORITE, callback_data: mkCb(CB.FAV, "add", candidateId) }
      ],
      [{ text: BUTTONS.MENU, callback_data: mkCb(CB.SYS, "menu") }]
    ];
  },

  // Просмотр анкет с навигацией по фото
  browseCardWithNav(candidateId: number, total: number, currentIndex: number): InlineKeyboardButton[][] {
    const base = this.browseCard(candidateId);
    if (total <= 1) return base;

    const prev = (currentIndex - 1 + total) % total;
    const next = (currentIndex + 1) % total;

    const navRow: InlineKeyboardButton[] = [
      { text: "◀️", callback_data: mkCb(CB.BRW, "phnav", prev) },
      { text: `📸 ${currentIndex + 1}/${total}`, callback_data: mkCb(CB.BRW, "noop") },
      { text: "▶️", callback_data: mkCb(CB.BRW, "phnav", next) },
    ];
    return [navRow, ...base];
  },

  // Входящие запросы
  requestIncoming(crId: number, fromUserId: number): InlineKeyboardButton[][] {
    return [
      [
        { text: BUTTONS.ACCEPT, callback_data: mkCb(CB.CR, "accept", crId) },
        { text: BUTTONS.DECLINE, callback_data: mkCb(CB.CR, "decline", crId) }
      ],
      [
        { text: BUTTONS.ADD_FAVORITE, callback_data: mkCb(CB.FAV, "add", fromUserId) },
        { text: BUTTONS.REPORT, callback_data: mkCb(CB.REP, "request", crId) }
      ]
    ];
  },

  // Избранное
  favoritesList(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.FIND_MORE, callback_data: mkCb(CB.BRW, "start") }],
      [{ text: BUTTONS.PROFILE, callback_data: mkCb(CB.PRF, "open") }],
      [{ text: BUTTONS.MENU, callback_data: mkCb(CB.SYS, "menu") }]
    ];
  },

  // Принятые контакты — пагинация
  acceptedList(page: number, hasPrev: boolean, hasNext: boolean): InlineKeyboardButton[][] {
    // На первой странице не показываем кнопки листания вовсе
    if (page === 0) {
      return [[{ text: "🏠 В меню", callback_data: mkCb(CB.SYS, "menu") }]];
    }

    const row: InlineKeyboardButton[] = [];
    if (hasPrev) row.push({ text: "◀️", callback_data: mkCb(CB.CR, "accepted", page - 1) });
    row.push({ text: "🏠 В меню", callback_data: mkCb(CB.SYS, "menu") });
    if (hasNext) row.push({ text: "▶️", callback_data: mkCb(CB.CR, "accepted", page + 1) });
    return [row];
  },

  // Рулетка
  rouletteWaiting(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.STOP_SEARCH, callback_data: mkCb(CB.RL, "stop") }],
      [{ text: BUTTONS.MENU, callback_data: mkCb(CB.SYS, "menu") }]
    ];
  },

  rouletteChat(): InlineKeyboardButton[][] {
    return [
      [{ text: BUTTONS.STOP_CHAT, callback_data: mkCb(CB.RL, "stop") }],
      [{ text: BUTTONS.MENU, callback_data: mkCb(CB.SYS, "menu") }]
    ];
  },

  // Подтверждение пересоздания
  restartConfirm(): InlineKeyboardButton[][] {
    return [
      [
        { text: BUTTONS.RESTART_CONFIRM, callback_data: mkCb(CB.PRF, "restart_yes") },
        { text: BUTTONS.CANCEL, callback_data: mkCb(CB.PRF, "open") }
      ]
    ];
  },

  // Общие кнопки
  backToMenu(): InlineKeyboardButton[][] {
    return [[{ text: BUTTONS.MENU, callback_data: mkCb(CB.SYS, "menu") }]];
  },

  // Пустая клавиатура (для удаления)
  empty(): InlineKeyboardButton[][] {
    return [];
  }
};

// ===== УТИЛИТЫ =====
export const KeyboardUtils = {
  // Добавить кнопку "Назад в меню" к любой клавиатуре
  withBackToMenu(keyboard: InlineKeyboardButton[][]): InlineKeyboardButton[][] {
    return [...keyboard, ...Keyboards.backToMenu()];
  },

  // Создать кнопку с произвольным callback
  button(text: string, callback: string): InlineKeyboardButton {
    return { text, callback_data: callback };
  },

  // Создать ряд кнопок
  row(...buttons: InlineKeyboardButton[]): InlineKeyboardButton[] {
    return buttons;
  },

  // Создать клавиатуру из рядов
  keyboard(...rows: InlineKeyboardButton[][]): InlineKeyboardButton[][] {
    return rows;
  }
};
