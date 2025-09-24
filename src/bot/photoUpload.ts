// src/index.ts
import TelegramBot, { Message } from "node-telegram-bot-api";
import { BOT_TOKEN } from "../config.js";
import { query, waitForDb } from "./db.js";

import { ensureUser, sendScreen } from "./bot/helpers.js";
import type { DbUser } from "./bot/helpers.js";
import { showMainMenu, showHelp } from "./bot/menu.js";
import {
  handleStartName,
  handleRegNameManual,
  handleRegName,
  validateName,
  regAskAge,
  handleRegAge,
  handleRegCity,
  regAskPhoto,
  regShowPreview,
} from "./bot/registration.js";
import { handleCallback } from "./router/callback.js";
import { showProfile } from "./bot/profile.js";
import { TXT } from "./ui/text.js";
import { logger } from "./lib/logger.js";
import { ErrorHandler } from "./lib/errorHandler.js";
import { mkCb } from "./ui/cb.js";
import { CB } from "./types.js";

// ✅ фото-импорты: обработчик входящих фото вынесен в отдельный модуль
import { handleUploadPhotoMessage, finalizeUploadSessionToDb } from "./bot/photoUpload.js";
// ✅ базовые операции/константы по фото
import { MAX_PROFILE_PHOTOS, addPhotoSafely } from "./bot/photo.js";

// анти-дребезг
const messageCooldown = new Map<number, number>();
const MESSAGE_COOLDOWN_MS = 2000;
const isCooldown = (id: number) => {
  const t = messageCooldown.get(id);
  return t ? Date.now() - t < MESSAGE_COOLDOWN_MS : false;
};
const setCooldown = (id: number) => messageCooldown.set(id, Date.now());

// утилита: липкое приветствие отдельным сообщением (НЕ sendScreen)
async function stickyWelcome(bot: TelegramBot, chatId: number, name?: string | null) {
  const n = (name || "").trim();
  if (!n) return;
  await bot.sendMessage(chatId, TXT.start.welcome.replace("{name}", n));
}

async function loadUser(tgId: number): Promise<DbUser | undefined> {
  try {
    const t0 = Date.now();
    const r = await query<DbUser>(`SELECT * FROM users WHERE tg_id = $1`, [tgId]);
    logger.debug("SQL executed", {
      action: "db_query",
      sql: "SELECT * FROM users WHERE tg_id = $1",
      ms: Date.now() - t0,
      tgId,
    });
    return r.rows[0];
  } catch (error) {
    await ErrorHandler.handleDatabaseError(error as Error, "SELECT * FROM users WHERE tg_id = $1", "loadUser");
    throw error;
  }
}

async function bootstrap() {
  try {
    logger.info("Starting bot bootstrap process");
    logger.info("Waiting for database connection...");
    await waitForDb();
    logger.info("Database connection established");
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not configured");

    const bot = new TelegramBot(BOT_TOKEN, { polling: true });
    ErrorHandler.initialize(bot, process.env.ADMIN_CHAT_ID);
    logger.info("Bot instance created successfully");

    // guard от пустых sendMessage
    const _orig = bot.sendMessage.bind(bot);
    bot.sendMessage = (chatId: number | string, text: any, options?: any) => {
      const t = typeof text === "string" ? text : "";
      if (!t || !t.trim()) {
        logger.warn("Empty text in sendMessage prevented", { action: "empty_message_guard", chatId: Number(chatId), options });
        text = "—";
      }
      return _orig(chatId as any, text, options);
    };

    bot.on("polling_error", async (e: any) => ErrorHandler.handleBotError(e as Error, "polling_error"));
    (bot as any).on("error", async (e: any) => ErrorHandler.handleBotError(e as Error, "bot_error"));

    bot.setMyCommands([
      { command: "start", description: "Старт" },
      { command: "menu", description: "Меню" },
      { command: "profile", description: "Профиль" },
      { command: "browse", description: "Смотреть анкеты" },
      { command: "roulette", description: "Чат-рулетка" },
      { command: "nearby", description: "Люди рядом" },
      { command: "contacts", description: "Принятые контакты" },
      { command: "requests", description: "Запросы на контакты" },
      { command: "help", description: "Справка" },
      { command: "sharetest", description: "Тест кнопки геолокации" },
    ]).catch(() => {});

    // /start | /menu
    bot.onText(/^\/(start|menu)$/i, async (msg) => {
      try {
        const chatId = msg.chat.id;
        const userId = msg.from?.id || 0;

        const u: DbUser = await ensureUser(chatId, msg.from?.username);
        logger.info("User issued /start or /menu", { action: "command_start_menu", chatId, userId, status: u.status, state: u.state });

        // новый пользователь или нет state → запускаем регистрацию
        if (u.status === "new" || !u.state) {
          const first = msg.from?.first_name;
          if (first && validateName(first).valid) {
            // записываем имя сразу и шлём ЛИПКИЙ привет
            await query(`UPDATE users SET name=$2, updated_at=now() WHERE tg_id=$1`, [chatId, first.trim()]);
            await stickyWelcome(bot, chatId, first.trim());
            await regAskAge(bot, chatId, u);
            return;
          }
          // иначе — обычная логика старта регистрации
          await handleStartName(bot, chatId, u, msg.from?.first_name);
          return;
        }

        await showMainMenu(bot, chatId, u);
      } catch (error) {
        await ErrorHandler.handleUserError(error as Error, msg.from?.id || 0, msg.chat.id, "start_menu");
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

    bot.onText(/^\/sharetest$/i, async (msg) => {
      const kb = {
        keyboard: [
          [{ text: TXT.reg.cityShareBtn, request_location: true }],
          [{ text: TXT.reg.cityManualBtn }],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      } as any;
      await bot.sendMessage(msg.chat.id, "Тест: на мобильном Telegram появится кнопка ниже.", { reply_markup: kb });
    });

    // роутер сообщений
    bot.on("message", async (msg: Message) => {
      try {
        if (!msg.from) return;
        if (msg.text && msg.text.startsWith("/")) return;

        const chatId = msg.chat.id;
        if (isCooldown(chatId)) {
          logger.warn("Message ignored due to cooldown", { action: "message_cooldown", chatId, userId: msg.from.id });
          return;
        }
        setCooldown(chatId);

        await ensureUser(chatId, msg.from.username);
        const fresh = await loadUser(chatId);
        if (!fresh) return;

        const state = (fresh.state || "") as string;

        switch (state) {
          case "reg_name_manual":
            if (msg.text) await handleRegNameManual(bot, msg, fresh);
            return;
          case "reg_name":
            if (msg.text) await handleRegName(bot, msg, fresh);
            return;
          case "reg_age":
            await handleRegAge(bot, msg, fresh);
            return;
          case "reg_gender":
          case "reg_seek":
            return; // эти шаги только через inline-кнопки
          case "reg_city":
          case "reg_city_text":
            if (msg.text || msg.location) await handleRegCity(bot, msg, fresh);
            return;
          case "reg_about":
            return; // обрабатывается колбэками
          case "reg_photo_method":
            return; // выбор через inline
          // ✅ фото во время регистрации: приём входящих изображений
          case "reg_photo":
          case "reg_photo_upload":
          case "reg_photo_upload_preview":
            if (msg.photo?.length) {
              await handleUploadPhotoMessage(bot, msg, fresh);
            } else {
              await sendScreen(bot, chatId, fresh, {
                text: "Отправьте фотографию или используйте кнопки на экране.",
              });
            }
            return;
          case "reg_preview":
            await regShowPreview(bot, chatId, fresh);
            return;

          // режимы редактирования профиля
          case "edit_about":
            if (msg.text) {
              const about = msg.text.trim();
              if (about.length > 300) {
                await sendScreen(bot, chatId, fresh, { text: TXT.validation.aboutTooLong });
                return;
              }
              await query(
                `UPDATE users SET about=$2, state='idle', updated_at=now() WHERE tg_id=$1`,
                [chatId, about || null]
              );
              const u = await ensureUser(chatId, msg.from.username);
              await showProfile(bot, chatId, u);
            }
            return;

          // ✅ редактирование фото — загрузка пачкой
          case "edit_photo_upload":
            if (msg.photo?.length) {
              await handleUploadPhotoMessage(bot, msg, fresh);
            }
            return;

          // ✅ редактирование фото — одиночное добавление (как раньше)
          case "edit_photo":
            if (msg.photo?.length) {
              const best = msg.photo.slice(-1)[0];
              try {
                const { total } = await addPhotoSafely(chatId, best.file_id);
                await sendScreen(bot, chatId, fresh, {
                  text: `Фото добавлено (${total}/${MAX_PROFILE_PHOTOS}).`,
                  keyboard: [[{ text: "✅ Готово", callback_data: mkCb(CB.PRF, "photo_done") }]],
                });
              } catch (e: any) {
                if (String(e?.message || "").includes("LIMIT_REACHED")) {
                  await sendScreen(bot, chatId, fresh, {
                    text: `Максимум ${MAX_PROFILE_PHOTOS} фото. Нажми «Готово».`,
                  });
                } else {
                  await sendScreen(bot, chatId, fresh, {
                    text: "Не удалось сохранить фото. Попробуйте ещё раз.",
                  });
                }
              }
            }
            return;

          default:
            return;
        }
      } catch (error) {
        await ErrorHandler.handleUserError(error as Error, msg.from?.id || 0, msg.chat.id, "message_router");
      }
    });

    // колбэки
    bot.on("callback_query", async (cq) => {
      try {
        await handleCallback(bot, cq);
      } catch (error) {
        const chatId = cq.message?.chat.id || 0;
        await ErrorHandler.handleUserError(error as Error, cq.from?.id || 0, chatId, "callback_query");
      }
    });

    logger.info("Bot polling started successfully");
  } catch (error) {
    await ErrorHandler.handleBotError(error as Error, "bootstrap");
    throw error;
  }
}

async function startBot() {
  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await bootstrap();
      break;
    } catch (error) {
      retries++;
      logger.error("Bootstrap attempt failed", {
        action: "bootstrap_retry",
        attempt: retries,
        maxRetries,
        error: (error as Error)?.message || String(error),
      });

      if (retries >= maxRetries) {
        logger.error("All bootstrap attempts failed, exiting", {
          action: "bootstrap_final_failure",
          totalAttempts: retries,
        });
        process.exit(1);
      }

      const delay = Math.min(1000 * 2 ** (retries - 1), 10000);
      logger.info("Retrying bootstrap", { action: "bootstrap_retry_wait", delay });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

startBot();

export { handleIncomingPhoto };
