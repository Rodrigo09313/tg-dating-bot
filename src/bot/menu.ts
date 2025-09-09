// src/bot/menu.ts
// Главное меню и /help. Всегда отдаём осмысленный текст, чтобы не было пустых sendMessage.

import TelegramBot from "node-telegram-bot-api";
import { DbUser, sendScreen, setState } from "./helpers";

export async function showMainMenu(bot: TelegramBot, chatId: number, user: DbUser) {
  await setState(chatId, "idle");
  const text = "✨ Выбери действие:";
  const keyboard = [
    [{ text: "🎲 Чат рулетка", callback_data: "rl:find" }],
    [{ text: "💞 Знакомства", callback_data: "brw:start" }],
    [{ text: "👤 Профиль", callback_data: "prf:open" }],
    [{ text: "❓ Помощь", callback_data: "sys:help" }]
  ];
  await sendScreen(bot, chatId, user, {
    text,
    keyboard,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export async function showHelp(bot: TelegramBot, chatId: number, user: DbUser) {
  const text = [
    "💫 <b>Справка по боту</b>",
    "",
    "📋 <b>Регистрация:</b>",
    "Заполни возраст, пол, город и добавь фото",
    "",
    "👥 <b>Знакомства:</b>", 
    "Смотри анкеты и отправляй запросы",
    "",
    "🎲 <b>Чат-рулетка:</b>",
    "Анонимный чат с ближайшим пользователем",
    "",
    "📨 <b>Контакты:</b>",
    "Управляй запросами и контактами"
  ].join("\n");
  
  const keyboard = [
    [{ text: "🎲 Чат рулетка", callback_data: "rl:find" }],
    [{ text: "💞 Знакомства", callback_data: "brw:start" }],
    [{ text: "👤 Профиль", callback_data: "prf:open" }],
    [{ text: "🏠 Меню", callback_data: "sys:menu" }]
  ];
  
  await sendScreen(bot, chatId, user, {
    text,
    keyboard,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}