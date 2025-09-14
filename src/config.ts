import 'dotenv/config';

export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN is required');
}

if (!ADMIN_CHAT_ID) {
  throw new Error('ADMIN_CHAT_ID is required');
}

export const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgres://${process.env.POSTGRES_USER || "tguser"}:${process.env.POSTGRES_PASSWORD || "tgpass"}@${process.env.DB_HOST || "127.0.0.1"}:${process.env.DB_PORT || "5432"}/${process.env.POSTGRES_DB || "tgdb"}`;

/** Геокодер */
export const GEOCODER_PROVIDER = (process.env.GEOCODER_PROVIDER || "yandex").toLowerCase();
export const GEOCODER_EMAIL = process.env.GEOCODER_EMAIL || "";
export const YANDEX_GEOCODER_KEY = process.env.YANDEX_GEOCODER_KEY || "";
export const YANDEX_ALLOW_STORE = String(process.env.YANDEX_ALLOW_STORE || "false").toLowerCase() === "true";
