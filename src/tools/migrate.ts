// src/tools/migrate.ts
// Простой раннер .sql миграций из папки migrations (по алфавиту).
import { Client } from "pg";
import fs from "fs";
import path from "path";
import "dotenv/config";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const dir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();

  const appliedRes = await client.query<{ filename: string }>(`SELECT filename FROM schema_migrations;`);
  const applied = new Set(appliedRes.rows.map(r => r.filename));

  for (const file of files) {
    if (applied.has(file)) { console.log(`Skip: ${file}`); continue; }
    const sql = fs.readFileSync(path.join(dir, file), "utf-8");
    console.log(`Applying ${file}...`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(`Failed ${file}`, e);
      process.exit(1);
    }
  }

  await client.end();
  console.log("Migrations complete.");
}
main().catch(err => { console.error(err); process.exit(1); });
