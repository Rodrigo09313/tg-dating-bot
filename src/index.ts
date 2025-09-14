// src/index.ts
import { Telegraf, Context } from 'telegraf';
import type { Message } from 'telegraf/typings/core/types/typegram';
import { BOT_TOKEN, ADMIN_CHAT_ID } from "./config";
import { query, waitForDb } from "./db";
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

    const bot = new Telegraf(BOT_TOKEN);

    ErrorHandler.initialize(bot, ADMIN_CHAT_ID);

    logger.info("Bot instance created successfully");

    bot.use(async (ctx: Context, next: () => Promise<void>) => {
      try {
        await next();
      } catch (e) {
        await ErrorHandler.handleBotError(e as Error, 'middleware', ctx.from?.id, ctx.chat?.id);
      }
    });

    bot.catch(async (e, ctx) => {
      await ErrorHandler.handleBotError(e as Error, 'bot_error', ctx.from?.id, ctx.chat?.id);
    });

    await bot.telegram.setMyCommands([
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
    bot.command(['start', 'menu'], async (ctx) => {
      const msg = ctx.message as Message;
      try {
        const chatId = ctx.chat?.id!;
        const userId = ctx.from?.id;

        logger.userAction('command_start_menu', userId || 0, chatId);

        const u = await ensureUser(chatId, ctx.from?.username);
        if (u.status === "new" || !u.state) {
          await handleStartName(bot, chatId, u, ctx.from?.first_name);
          return;
        }
        await showMainMenu(bot, chatId, u);
      } catch (error) {
        await ErrorHandler.handleUserError(error as Error, ctx.from?.id || 0, ctx.chat?.id || 0, 'start_menu');
      }
    });

    bot.command('help', async (ctx) => {
      const u = await ensureUser(ctx.chat?.id!, ctx.from?.username);
      await showHelp(bot, ctx.chat?.id!, u);
    });

    bot.command('profile', async (ctx) => {
      const u = await ensureUser(ctx.chat?.id!, ctx.from?.username);
      await showProfile(bot, ctx.chat?.id!, u);
    });

    // Тестовая команда для проверки reply-кнопки геолокации
    bot.command('sharetest', async (ctx) => {
      const kb = {
        keyboard: [
          [{ text: TXT.reg.cityShareBtn, request_location: true }],
          [{ text: TXT.reg.cityManualBtn }],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      } as any;
      await ctx.reply("Тест: на мобильном Telegram появится кнопка ниже.", { reply_markup: kb });
    });

    // Текст/медиа по состояниям
    bot.on('message', async (ctx) => {
      const msg = ctx.message as Message;
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

    if (state === "reg_name_manual") {
      if (msg.text) {
        await handleRegNameManual(bot, msg, fresh);
      }
      return;
    }

    if (state === "reg_photo" || state === "reg_photo_upload" || state === "reg_photo_upload_preview") {
      if (msg.photo && msg.photo.length) {
        await handleRegPhotoMessage(bot, msg, fresh);
        return;
      }
      return;
    }

    if (state === "reg_photo_method") {
      // Состояние выбора способа загрузки фото - игнорируем произвольные сообщения
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
          await sendScreen(bot, chatId, fresh, { text: TXT.validation.aboutTooLong });
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
          await sendScreen(bot, chatId, fresh, { 
            text: `Фото добавлено (${total}/3).`,
            keyboard: [[{ text: "✅ Готово", callback_data: mkCb(CB.PRF, "photo_done") }]]
          });
        } catch (e: any) {
          if (e && String(e.message).includes("LIMIT_REACHED")) {
            await sendScreen(bot, chatId, fresh, { text: "Максимум 3 фото. Нажми «Готово»." });
          } else {
            await sendScreen(bot, chatId, fresh, { text: "Не удалось сохранить фото. Попробуйте ещё раз." });
          }
        }
      }
      return;
    }
  });

    // Кнопки (inline callbacks)
    bot.on('callback_query', async (ctx) => {
      if (ctx.callbackQuery) await handleCallback(bot, ctx.callbackQuery);
    });

    await bot.launch();
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
