// src/tools/clearInteractions.ts
import 'dotenv/config';
import { pool, query, waitForDb } from "../db.js";

/**
 * Очищает историю взаимодействий: contact_requests, contacts
 * Профили (users, photos) не трогаем.
 *
 * Параметры (env или CLI):
 *  - USER_ID: tg_id конкретного пользователя — тогда чистим только его взаимодействия
 *  - CONFIRM=yes: обязательное подтверждение
 */
async function main() {
  const userIdEnv = process.env.USER_ID;
  const confirm = (process.env.CONFIRM || "").toLowerCase() === "yes";
  if (!confirm) {
    console.error("Set CONFIRM=yes to proceed");
    process.exit(2);
  }

  await waitForDb();

  if (userIdEnv) {
    const uid = BigInt(userIdEnv);
    // Удаляем входящие/исходящие запросы
    await query(`DELETE FROM contact_requests WHERE from_id = $1::bigint OR to_id = $1::bigint`, [uid.toString()]);
    // Удаляем контакты
    await query(`DELETE FROM contacts WHERE a_id = $1::bigint OR b_id = $1::bigint`, [uid.toString()]);
    console.log(`Cleared interactions for user ${uid}`);
  } else {
    await query(`TRUNCATE contact_requests RESTART IDENTITY`);
    await query(`TRUNCATE contacts RESTART IDENTITY`);
    console.log("Cleared all interactions (requests, contacts)");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => pool.end());


