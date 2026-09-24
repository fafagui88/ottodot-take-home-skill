import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { expect } from "vitest";
import { getPool } from "@/lib/db";
import { BookingError, type BookingErrorCode } from "@/lib/errors";
import { resetDatabase } from "@/lib/reset";

// Seed ids (mysql/init/02_seed.sql)
export const PARENT = { sarah: 1, budi: 2, priya: 3 } as const;
export const STUDENT = { ava: 1, leo: 2, mia: 3, noah: 4, sari: 5, dimas: 6, arjun: 7, isha: 8, rohan: 9 } as const;
export const CLASS = { robotics: 1, fractions: 2, volcano: 3 } as const;

export async function resetTestDb() {
  const url = process.env.DATABASE_URL ?? "";
  // Never wipe the demo database by accident.
  if (!/\/ottodot_test(\?|$)/.test(url)) {
    throw new Error(`Refusing to run tests: DATABASE_URL must point at the ottodot_test database (got "${url}")`);
  }
  await resetDatabase();
}

export async function expectBookingError(promise: Promise<unknown>, code: BookingErrorCode) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected BookingError ${code}`).toBeInstanceOf(BookingError);
  expect((err as BookingError).code).toBe(code);
  return err as BookingError;
}

export async function confirmedCount(classId: number): Promise<number> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    "SELECT confirmed_count FROM trial_classes WHERE id = ?",
    [classId],
  );
  return rows[0].confirmed_count;
}

/** Adds n extra children to a parent so we can simulate many competing families. */
export async function addStudents(parentId: number, n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const [res] = await getPool().execute<ResultSetHeader>(
      "INSERT INTO students (parent_id, name, grade) VALUES (?, ?, 4)",
      [parentId, `Racer ${i + 1}`],
    );
    ids.push(res.insertId);
  }
  return ids;
}

let keySeq = 0;
export const key = (label = "k") => `test-${label}-${++keySeq}-${Date.now()}`;
