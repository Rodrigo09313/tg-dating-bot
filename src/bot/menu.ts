// src/bot/menu.ts
// Главное меню и /help. Всегда отдаём осмысленный текст, чтобы не было пустых sendMessage.

import { Telegraf, Context } from 'telegraf';
import { DbUser, sendScreen, setState } from "./helpers";
import { Keyboards } from "../ui/keyboards";
import { TXT } from "../ui/text";

export async function showMainMenu(bot: Telegraf<Context>, chatId: number, user: DbUser) {
  await setState(chatId, "idle");
  const text = TXT.menu.mainTitle;
  const keyboard = Keyboards.mainMenu();
  await sendScreen(bot, chatId, user, {
    text,
    keyboard,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export async function showHelp(bot: Telegraf<Context>, chatId: number, user: DbUser) {
  const text = [
    TXT.menu.helpTitle,
    "",
    TXT.menu.helpRegistration,
    "",
    TXT.menu.helpDating,
    "",
    TXT.menu.helpRoulette,
    "",
    TXT.menu.helpContacts
  ].join("\n");
  
  const keyboard = Keyboards.mainMenu();
  
  await sendScreen(bot, chatId, user, {
    text,
    keyboard,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}