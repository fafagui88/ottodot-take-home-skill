import mysql, { type Pool, type PoolConnection } from "mysql2/promise";

// Reuse one pool across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { ottodotPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.ottodotPool) {
    const uri = process.env.DATABASE_URL;
    if (!uri) throw new Error("DATABASE_URL is not set");
    globalForDb.ottodotPool = mysql.createPool({
      uri,
      connectionLimit: 20,
      timezone: "Z",
    });
  }
  return globalForDb.ottodotPool;
}

export async function closePool(): Promise<void> {
  if (globalForDb.ottodotPool) {
    await globalForDb.ottodotPool.end();
    globalForDb.ottodotPool = undefined;
  }
}

/** Runs fn inside BEGIN/COMMIT on a single connection; any throw rolls back. */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ER_DUP_ENTRY";
}
