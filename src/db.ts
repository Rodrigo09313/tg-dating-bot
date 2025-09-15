// src/db.ts
import { Pool, QueryResult, QueryResultRow } from "pg";
import { DATABASE_URL } from "./config";

export const pool = new Pool({ connectionString: DATABASE_URL });

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withTx<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Ждём доступности БД с ретраями, чтобы избежать ECONNREFUSED на старте
export async function waitForDb(tries = 30, delayMs = 1000): Promise<void> {
  let lastErr: any;
  for (let i = 1; i <= tries; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
