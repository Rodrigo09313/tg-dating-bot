// src/ui/buttons.ts
import { InlineKeyboardButton } from "node-telegram-bot-api";
import { mkCb } from "./cb";
import { CB } from "../types";

export const kb = {
  menu(): InlineKeyboardButton[][] {
    return [
      [{ text: "💞 Найти пару", callback_data: mkCb(CB.BRW, "start") }],
      [{ text: "⭐ Избранное", callback_data: mkCb(CB.FAV, "list") }],
      [{ text: "💌 Мои запросы", callback_data: mkCb(CB.CR, "list") }],
      [{ text: "🖼️ Мои фото", callback_data: mkCb(CB.PRF, "photo") }],
      [{ text: "📝 О себе", callback_data: mkCb(CB.PRF, "about") }],
      [{ text: "🔄 Пересоздать", callback_data: mkCb(CB.PRF, "restart_confirm") }]
    ];
  },

  profile(): InlineKeyboardButton[][] {
    return [
      [{ text: "💞 Найти пару", callback_data: mkCb(CB.BRW, "start") }],
      [{ text: "⭐ Избранное", callback_data: mkCb(CB.FAV, "list") }],
      [{ text: "💌 Мои запросы", callback_data: mkCb(CB.CR, "list") }],
      [{ text: "🖼️ Мои фото", callback_data: mkCb(CB.PRF, "photo") }],
      [{ text: "📝 О себе", callback_data: mkCb(CB.PRF, "about") }],
      [{ text: "🔄 Пересоздать", callback_data: mkCb(CB.PRF, "restart_confirm") }]
    ];
  },

  profileWithNav(total: number, currentIndex: number): InlineKeyboardButton[][] {
    const base = kb.profile();
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

  regGender(): InlineKeyboardButton[][] {
    return [
      [
        { text: "👨 Мужчина", callback_data: mkCb(CB.REG, "gender", "m") },
        { text: "👩 Женщина", callback_data: mkCb(CB.REG, "gender", "f") }
      ]
    ];
  },

  regSeek(): InlineKeyboardButton[][] {
    return [
      [
        { text: "👨 Мужчин", callback_data: mkCb(CB.REG, "seek", "m") },
        { text: "👩 Женщин", callback_data: mkCb(CB.REG, "seek", "f") }
      ],
      [
        { text: "👥 Всех", callback_data: mkCb(CB.REG, "seek", "b") }
      ]
    ];
  },

  regPhotoActions(): InlineKeyboardButton[][] {
    return [
      [
        { text: "📥 Импорт фото", callback_data: mkCb(CB.REG, "photo_import") }
      ],
      [
        { text: "✅ Завершить", callback_data: mkCb(CB.REG, "photo_done") }
      ]
    ];
  },

  regPhotoRetryActions(): InlineKeyboardButton[][] {
    return [
      [
        { text: "🔄 Повторить", callback_data: mkCb(CB.REG, "photo_import") }
      ],
      [
        { text: "✅ Продолжить", callback_data: mkCb(CB.REG, "photo_done") }
      ]
    ];
  },

  prfPhotoActions(): InlineKeyboardButton[][] {
    return [
      [
        { text: "📥 Импорт фото", callback_data: mkCb(CB.PRF, "photo_import") }
      ],
      [
        { text: "✅ Готово", callback_data: mkCb(CB.PRF, "photo_done") }
      ]
    ];
  },

  prfPhotoRetryActions(): InlineKeyboardButton[][] {
    return [
      [
        { text: "🔄 Повторить", callback_data: mkCb(CB.PRF, "photo_import") }
      ],
      [
        { text: "✅ Продолжить", callback_data: mkCb(CB.PRF, "photo_done") }
      ]
    ];
  },

  browseCard(candidateId: number): InlineKeyboardButton[][] {
    return [
      [
        { text: "💞 Следующий", callback_data: mkCb(CB.BRW, "next") }
      ],
      [
        { text: "💌 Написать", callback_data: mkCb(CB.CR, "req", candidateId) },
        { text: "⭐ В избранное", callback_data: mkCb(CB.FAV, "add", candidateId) }
      ],
      [
        { text: "🚩 Пожаловаться", callback_data: mkCb(CB.REP, "card", candidateId) }
      ]
    ];
  },

  requestIncoming(crId: number): InlineKeyboardButton[][] {
    return [
      [
        { text: "✅ Принять", callback_data: mkCb(CB.CR, "accept", crId) },
        { text: "❌ Отклонить", callback_data: mkCb(CB.CR, "decline", crId) }
      ],
      [
        { text: "⭐ В избранное", callback_data: mkCb(CB.FAV, "add", crId) },
        { text: "🚩 Пожаловаться", callback_data: mkCb(CB.REP, "request", crId) }
      ]
    ];
  },

  favoritesList(): InlineKeyboardButton[][] {
    return [
      [
        { text: "💞 Найти ещё", callback_data: mkCb(CB.BRW, "start") }
      ],
      [
        { text: "👤 Профиль", callback_data: mkCb(CB.PRF, "open") }
      ],
      [
        { text: "🏠 В меню", callback_data: mkCb(CB.SYS, "menu") }
      ]
    ];
  }
};