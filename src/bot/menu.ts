// src/bot/menu.ts
import TelegramBot from "node-telegram-bot-api";
import { DbUser, sendScreen } from "./helpers";
import { kb } from "../ui/buttons";
import { TXT } from "../ui/text";

export async function showMainMenu(bot: TelegramBot, chatId: number, user: DbUser) {
  await sendScreen(bot, chatId, user, { text: TXT.menuTitle, keyboard: kb.menu() });
}

export async function showHelp(bot: TelegramBot, chatId: number, user: DbUser) {
  await sendScreen(bot, chatId, user, { text: TXT.help });
}
