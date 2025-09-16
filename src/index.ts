import type { DbUser } from "./bot/helpers";
// src/index.ts
import TelegramBot, { Message } from "node-telegram-bot-api";
import { BOT_TOKEN } from "./config";
import { query, waitForDb } from "./db";

console.log("Starting bot...");
console.log("BOT_TOKEN:", BOT_TOKEN ? "SET" : "NOT SET");
import { ensureUser, sendScreen } from "./bot/helpers";
import { showMainMenu, showHelp } from "./bot/menu";
import {
  regAskAge, handleRegAge, handleRegCity,
  regAskPhoto, handleRegPhotoMessage, regShowPreview,
  handleStartName, handleRegNameManual, startRestartWithName
} from "./bot/registration";
import { handleCallback } from "./router/callback";
import { showProfile } from "./bot/profile";
import { TXT } from "./ui/text";
import { logger } from "./lib/logger";
import { ErrorHandler } from "./lib/errorHandler";

// Защита от двойных нажатий для сообщений
const messageCooldown = new Map<number, number>();
const MESSAGE_COOLDOWN_MS = 2000; // 2 секунды между сообщениями

function isMessageOnCooldown(chatId: number): boolean {
  const lastMessage = messageCooldown.get(chatId);
  if (!lastMessage) return false;
  
  const now = Date.now();
  const timeSinceLastMessage = now - lastMessage;
  
  return timeSinceLastMessage < MESSAGE_COOLDOWN_MS;
}

function setMessageCooldown(chatId: number): void {
  messageCooldown.set(chatId, Date.now());
}
import { mkCb } from "./ui/cb";
import { CB } from "./types";

async function loadUser(tgId: number) {
  try {
    const startTime = Date.now();
    const r = await query(`
      SELECT tg_id::text, username, name, state, last_screen_msg_id::text, last_screen_at::text, status
      FROM users WHERE tg_id = $1
    `, [tgId]);
    
    logger.dbQuery('SELECT user data', Date.now() - startTime);
    return r.rows[0];
  } catch (error) {
    await ErrorHandler.handleDatabaseError(error as Error, 'SELECT user data', 'loadUser');
    throw error;
  }
}

async function bootstrap() {
  try {
    logger.info("Starting bot bootstrap process");
    
    logger.info("Waiting for database connection...");
    await waitForDb();
    logger.info("Database connection established");

    if (!BOT_TOKEN) {
      throw new Error("BOT_TOKEN is not configured");
    }

    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    
    // Инициализируем обработчик ошибок
    ErrorHandler.initialize(bot, process.env.ADMIN_CHAT_ID);
    
    logger.info("Bot instance created successfully");

    
    // === Глобальные перехватчики и логи ===
    // Лог ошибок поллинга/сетевых
    bot.on("polling_error", async (e: any) => {
      await ErrorHandler.handleBotError(e as Error, 'polling_error');
    });
    
    (bot as any).on("error", async (e: any) => {
      await ErrorHandler.handleBotError(e as Error, 'bot_error');
    });

    // Обёртка над sendMessage: не даём отправить пустой текст
    const __origSendMessage = bot.sendMessage.bind(bot);
    bot.sendMessage = (chatId: number | string, text: any, options?: any) => {
      const t = (typeof text === "string" ? text : "");
      if (!t || !t.trim()) {
        const err = new Error("sendMessage(text) был пустым — автозамена на «—»");
        logger.warn("Empty text in sendMessage prevented", {
          action: 'empty_message_guard',
          chatId: Number(chatId),
          options
        });
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
      try {
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        
        logger.userAction('command_start_menu', userId || 0, chatId);
        
        const u = await ensureUser(chatId, msg.from?.username);
        if (u.status === "new" || !u.state) {
          // Новый пользователь - обрабатываем имя
          await handleStartName(bot, chatId, u, msg.from?.first_name);
          return;
        }
        await showMainMenu(bot, chatId, u);
      } catch (error) {
        await ErrorHandler.handleUserError(error as Error, msg.from?.id || 0, msg.chat.id, 'start_menu');
      }
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
    
    // Защита от двойных нажатий для сообщений
    if (isMessageOnCooldown(chatId)) {
      logger.warn("Message ignored due to cooldown", {
        action: 'message_cooldown',
        chatId,
        userId: msg.from.id
      });
      return;
    }
    setMessageCooldown(chatId);
    
    await ensureUser(chatId, msg.from.username);
    const fresh = await loadUser(chatId);
    const state = fresh?.state as string | null;

    if (state === "reg_age") {
      await handleRegAge(bot, msg, fresh as DbUser);
      return;
    }

    if (state === "reg_gender" || state === "reg_seek") {
      // Эти шаги обрабатываются через callback-кнопки; игнорируем произвольные сообщения
      return;
    }

    if (state === "reg_city") {
      if (msg.location || msg.text) {
        await handleRegCity(bot, msg, fresh as DbUser);
        return;
      }
      return;
    }

    if (state === "reg_city_text") {
      if (msg.text || msg.location) {
        await handleRegCity(bot, msg, fresh as DbUser); // используем тот же обработчик (пришёл текст города)
        return;
      }
      return;
    }

    if (state === "reg_name_manual") {
      if (msg.text) {
        await handleRegNameManual(bot, msg, fresh as DbUser);
      }
      return;
    }

    if (state === "reg_photo" || state === "reg_photo_upload" || state === "reg_photo_upload_preview") {
      if (msg.photo && msg.photo.length) {
        await handleRegPhotoMessage(bot, msg, fresh as DbUser);
        return;
      }
      return;
    }

    if (state === "reg_photo_method") {
      // Состояние выбора способа загрузки фото - игнорируем произвольные сообщения
      return;
    }

    if (state === "reg_preview") {
      await regShowPreview(bot, chatId, fresh as DbUser);
      return;
    }

    // Редактирование профиля
    if (state === "edit_about") {
      if (msg.text) {
        const about = msg.text.trim();
        if (about.length > 300) {
          await sendScreen(bot, chatId, fresh as DbUser, { text: TXT.validation.aboutTooLong });
          return;
        }
        await query(`UPDATE users SET about=$2, state='idle', updated_at=now() WHERE tg_id=$1`, [chatId, about || null]);
        const u = await ensureUser(chatId, msg.from.username);
        await showProfile(bot, chatId, u);
      }
      return;
    }

    if (state === "edit_photo_upload") {
      if (msg.photo && msg.photo.length) {
        await handleRegPhotoMessage(bot, msg, fresh as DbUser);
        return;
      }
      return;
    }

    if (state === "edit_photo") {
      if (msg.photo && msg.photo.length) {
        const best = msg.photo.slice(-1)[0];
        const { addPhotoSafely } = await import("./bot/photo");
        try {
          const { total } = await addPhotoSafely(chatId, best.file_id);
          await sendScreen(bot, chatId, fresh as DbUser, { 
            text: `Фото добавлено (${total}/3).`,
            keyboard: [[{ text: "✅ Готово", callback_data: mkCb(CB.PRF, "photo_done") }]]
          });
        } catch (e: any) {
          if (e && String(e.message).includes("LIMIT_REACHED")) {
            await sendScreen(bot, chatId, fresh as DbUser, { text: "Максимум 3 фото. Нажми «Готово»." });
          } else {
            await sendScreen(bot, chatId, fresh as DbUser, { text: "Не удалось сохранить фото. Попробуйте ещё раз." });
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

    logger.info("Bot polling started successfully");
    
  } catch (error) {
    await ErrorHandler.handleBotError(error as Error, 'bootstrap');
    throw error;
  }
}

// Запуск с retry логикой
async function startBot() {
  const maxRetries = 3;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      await bootstrap();
      break; // Успешный запуск
    } catch (error) {
      retries++;
      logger.error(`Bootstrap attempt ${retries} failed`, {
        action: 'bootstrap_retry',
        attempt: retries,
        maxRetries,
        error: error as Error
      });
      
      if (retries >= maxRetries) {
        logger.error("All bootstrap attempts failed, exiting", {
          action: 'bootstrap_final_failure',
          totalAttempts: retries
        });
        process.exit(1);
      }
      
      // Экспоненциальная задержка между попытками
      const delay = Math.min(1000 * Math.pow(2, retries - 1), 10000);
      logger.info(`Retrying bootstrap in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

startBot();
