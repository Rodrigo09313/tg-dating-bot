// src/index.ts
import TelegramBot, { Message } from "node-telegram-bot-api";
import { BOT_TOKEN } from "./config";
import { query, waitForDb } from "./db";
import { ensureUser } from "./bot/helpers";
import { showMainMenu, showHelp } from "./bot/menu";
import {
  regAskAge, handleRegAge, handleRegCity,
  regAskName, handleRegName, regAskAbout, handleRegAbout,
  regAskPhoto, handleRegPhotoMessage, regShowPreview
} from "./bot/registration";
import { handleCallback } from "./router/callback";
import { showProfile } from "./bot/profile";
import { TXT } from "./ui/text";

async function loadUser(tgId: number) {
  const r = await query(`
    SELECT tg_id::text, username, name, state, last_screen_msg_id::text, last_screen_at::text, status
    FROM users WHERE tg_id = $1
  `, [tgId]);
  return r.rows[0];
}

async function bootstrap() {
  console.log("Waiting for database...");
  await waitForDb();
  console.log("Database is ready.");

  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  
  // === Глобальные перехватчики и логи ===
  // Лог ошибок поллинга/сетевых
  bot.on("polling_error", (e:any) => console.error("[polling_error]", e?.message || e));
  (bot as any).on("error", (e:any) => console.error("[bot error]", e?.message || e));

  // Обёртка над sendMessage: не даём отправить пустой текст
  const __origSendMessage = bot.sendMessage.bind(bot);
  bot.sendMessage = (chatId: number | string, text: any, options?: any) => {
    const t = (typeof text === "string" ? text : "");
    if (!t || !t.trim()) {
      const err = new Error("sendMessage(text) был пустым — автозамена на «—»");
      console.warn("[guard] Пустой текст в sendMessage. options=", options);
      console.warn(err.stack?.split("\n").slice(0,4).join("\n"));
      text = "—"; // безопасный видимый символ, чтобы Telegram не ругался
    }
    return __origSendMessage(chatId as any, text, options);
  };
// Команды
  bot.setMyCommands([
    { command: "start",     description: "Старт" },
    { command: "menu",      description: "Меню" },
    { command: "profile",   description: "Профиль" },
    { command: "browse",    description: "Смотреть анкеты" },
    { command: "roulette",  description: "Чат-рулетка" },
    { command: "nearby",    description: "Люди рядом" },
    { command: "contacts",  description: "Принятые контакты" },
    { command: "requests",  description: "Запросы на контакты" },
    { command: "help",      description: "Справка" },
    { command: "sharetest", description: "Тест кнопки геолокации" },
  ]).catch(()=>{});

  // /start,/menu — вход
  bot.onText(/^\/(start|menu)$/i, async (msg) => {
    const chatId = msg.chat.id;
    const u = await ensureUser(chatId, msg.from?.username);
    if (u.status === "new" || !u.state) {
      await regAskAge(bot, chatId, u);
      return;
    }
    await showMainMenu(bot, chatId, u);
  });

  bot.onText(/^\/help$/i, async (msg) => {
    const u = await ensureUser(msg.chat.id, msg.from?.username);
    await showHelp(bot, msg.chat.id, u);
  });

  bot.onText(/^\/profile$/i, async (msg) => {
    const u = await ensureUser(msg.chat.id, msg.from?.username);
    await showProfile(bot, msg.chat.id, u);
  });

  // Тестовая команда для проверки reply-кнопки геолокации
  bot.onText(/^\/sharetest$/i, async (msg) => {
    const kb = {
      keyboard: [
        [ { text: TXT.reg.cityShareBtn, request_location: true } ],
        [ { text: TXT.reg.cityManualBtn } ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    } as any;
    await bot.sendMessage(msg.chat.id, "Тест: на мобильном Telegram появится кнопка ниже.", { reply_markup: kb });
  });

  // Текст/медиа по состояниям
  bot.on("message", async (msg: Message) => {
    if (!msg.from) return;
    if (msg.text && msg.text.startsWith("/")) return;

    const chatId = msg.chat.id;
    await ensureUser(chatId, msg.from.username);
    const fresh = await loadUser(chatId);
    const state = fresh?.state as string | null;

    if (state === "reg_age") {
      await handleRegAge(bot, msg, fresh);
      return;
    }

    if (state === "reg_gender" || state === "reg_seek") {
      // Эти шаги обрабатываются через callback-кнопки; игнорируем произвольные сообщения
      return;
    }

    if (state === "reg_city") {
      if (msg.location || msg.text) {
        await handleRegCity(bot, msg, fresh);
        return;
      }
      return;
    }

    if (state === "reg_city_text") {
      if (msg.text || msg.location) {
        await handleRegCity(bot, msg, fresh); // используем тот же обработчик (пришёл текст города)
        return;
      }
      return;
    }

    if (state === "reg_name") {
      if (msg.text) {
        await handleRegName(bot, msg, fresh);
      }
      return;
    }

    if (state === "reg_about") {
      if (msg.text) {
        await handleRegAbout(bot, msg, fresh);
      }
      return;
    }

    if (state === "reg_photo") {
      if (msg.photo && msg.photo.length) {
        await handleRegPhotoMessage(bot, msg, fresh);
        return;
      }
      return;
    }

    if (state === "reg_preview") {
      await regShowPreview(bot, chatId, fresh);
      return;
    }

    // Редактирование профиля
    if (state === "edit_about") {
      if (msg.text) {
        const about = msg.text.trim();
        if (about.length > 300) {
          await bot.sendMessage(chatId, "До 300 символов, пожалуйста.");
          return;
        }
        await query(`UPDATE users SET about=$2, state='idle', updated_at=now() WHERE tg_id=$1`, [chatId, about || null]);
        const u = await ensureUser(chatId, msg.from.username);
        await showProfile(bot, chatId, u);
      }
      return;
    }

    if (state === "edit_photo") {
      if (msg.photo && msg.photo.length) {
        const best = msg.photo.slice(-1)[0];
        const { addPhotoSafely } = await import("./bot/photo");
        try {
          const { total } = await addPhotoSafely(chatId, best.file_id);
          await bot.sendMessage(chatId, `Фото добавлено (${total}/3).`, {
            reply_markup: { inline_keyboard: [[{ text: "✅ Готово", callback_data: "prf:photo_done" }]] }
          });
        } catch (e: any) {
          if (e && String(e.message).includes("LIMIT_REACHED")) {
            await bot.sendMessage(chatId, "Максимум 3 фото. Нажми «Готово».");
          } else {
            await bot.sendMessage(chatId, "Не удалось сохранить фото. Попробуйте ещё раз.");
          }
        }
      }
      return;
    }
  });

  // Кнопки (inline callbacks)
  bot.on("callback_query", async (cq) => {
    await handleCallback(bot, cq);
  });

  console.log("Bot polling started.");
}

bootstrap().catch(err => {
  console.error("Fatal bootstrap error", err);
  process.exit(1);
});
