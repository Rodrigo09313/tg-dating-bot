import 'dotenv/config';

export const BOT_TOKEN =
  process.env.BOT_TOKEN || "";

export const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgres://${process.env.POSTGRES_USER || "tguser"}:${process.env.POSTGRES_PASSWORD || "tgpass"}@${process.env.DB_HOST || "127.0.0.1"}:${process.env.DB_PORT || "5432"}/${process.env.POSTGRES_DB || "tgdb"}`;

/** Геокодер */
export const GEOCODER_PROVIDER = (process.env.GEOCODER_PROVIDER || "yandex").toLowerCase();
export const GEOCODER_EMAIL = process.env.GEOCODER_EMAIL || "";
export const YANDEX_GEOCODER_KEY = process.env.YANDEX_GEOCODER_KEY || "";
