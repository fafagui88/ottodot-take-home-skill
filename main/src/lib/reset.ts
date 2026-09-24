import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

/**
 * Re-creates the schema and seed data from mysql/init/*.sql, so the demo, the
 * tests and the MySQL container all share one source of truth.
 * In docker the folder is mounted at SQL_DIR=/app/sql.
 */
export function sqlDir(): string {
  return process.env.SQL_DIR ?? path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "mysql", "init");
}

export async function resetDatabase(opts: { seed?: boolean } = {}): Promise<void> {
  const uri = process.env.DATABASE_URL;
  if (!uri) throw new Error("DATABASE_URL is not set");

  const files = ["01_schema.sql", ...(opts.seed === false ? [] : ["02_seed.sql"])];
  const conn = await mysql.createConnection({ uri, multipleStatements: true, timezone: "Z" });
  try {
    for (const file of files) {
      // Runtime-mounted folder, not part of the build output.
      const sqlPath = path.join(/*turbopackIgnore: true*/ sqlDir(), file);
      await conn.query(await readFile(/*turbopackIgnore: true*/ sqlPath, "utf8"));
    }
  } finally {
    await conn.end();
  }
}
