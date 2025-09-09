// src/config.ts
import "dotenv/config";
export const BOT_TOKEN = process.env.BOT_TOKEN || "";
if (!BOT_TOKEN) throw new Error("BOT_TOKEN не задан в .env");
export const DATABASE_URL = process.env.DATABASE_URL || "postgres://tguser:tgpass@localhost:5432/tgdb";
export const SCREEN_TTL_MS = Number(process.env.SCREEN_TTL_MS || 300000); // 5 минут
