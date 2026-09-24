import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, isDuplicateKeyError, withTransaction } from "./db";
import { BookingError } from "./errors";
import { charge, refund, type ChargeOutcome } from "./paymentMock";

export type BookingStatus =
  | "pending_payment"
  | "confirmed"
  | "payment_failed"
  | "seat_unavailable"
  | "cancelled";

export type PaymentStatus = "processing" | "succeeded" | "failed" | "refunded";

export interface TrialClass {
  id: number;
  title: string;
  subject: string;
  startsAt: Date;
  capacity: number;
  confirmedCount: number;
  seatsLeft: number;
  priceCents: number;
}

export interface PaymentAttempt {
  id: number;
  idempotencyKey: string;
  amountCents: number;
  status: PaymentStatus;
  providerRef: string | null;
  failureReason: string | null;
  createdAt: Date;
}

export interface BookingDetail {
  id: number;
  status: BookingStatus;
  classId: number;
  classTitle: string;
  studentId: number;
  studentName: string;
  parentId: number;
  createdAt: Date;
  confirmedAt: Date | null;
  payments: PaymentAttempt[];
}

export interface PayResult {
  /** What happened to this payment attempt. */
  result: "confirmed" | "payment_failed" | "seat_unavailable" | "processing";
  /** true when the Idempotency-Key was already used and we returned the stored outcome. */
  replayed: boolean;
  booking: BookingDetail;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listParents() {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT id, name, email FROM parents ORDER BY id",
  );
  return rows.map((r) => ({ id: r.id as number, name: r.name as string, email: r.email as string }));
}

export async function listStudents(parentId: number) {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    "SELECT id, name, grade FROM students WHERE parent_id = ? ORDER BY id",
    [parentId],
  );
  return rows.map((r) => ({ id: r.id as number, name: r.name as string, grade: r.grade as number }));
}

function toClass(r: RowDataPacket): TrialClass {
  return {
    id: r.id,
    title: r.title,
    subject: r.subject,
    startsAt: r.starts_at,
    capacity: r.capacity,
    confirmedCount: r.confirmed_count,
    seatsLeft: r.capacity - r.confirmed_count,
    priceCents: r.price_cents,
  };
}

export async function listClasses(): Promise<TrialClass[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT * FROM trial_classes ORDER BY starts_at, id",
  );
  return rows.map(toClass);
}

export async function getBooking(bookingId: number): Promise<BookingDetail> {
  const pool = getPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT b.*, s.name AS student_name, c.title AS class_title
       FROM bookings b
       JOIN students s      ON s.id = b.student_id
       JOIN trial_classes c ON c.id = b.class_id
      WHERE b.id = ?`,
    [bookingId],
  );
  const b = rows[0];
  if (!b) throw new BookingError("NOT_FOUND", `Booking ${bookingId} not found`);

  const [payments] = await pool.execute<RowDataPacket[]>(
    "SELECT * FROM payment_attempts WHERE booking_id = ? ORDER BY id",
    [bookingId],
  );
  return {
    id: b.id,
    status: b.status,
    classId: b.class_id,
    classTitle: b.class_title,
    studentId: b.student_id,
    studentName: b.student_name,
    parentId: b.parent_id,
    createdAt: b.created_at,
    confirmedAt: b.confirmed_at,
    payments: payments.map((p) => ({
      id: p.id,
      idempotencyKey: p.idempotency_key,
      amountCents: p.amount_cents,
      status: p.status,
      providerRef: p.provider_ref,
      failureReason: p.failure_reason,
      createdAt: p.created_at,
    })),
  };
}

/** Roster for admins/teachers: confirmed students are the source of truth for class. */
export async function getRoster(classId: number) {
  const pool = getPool();
  const [classes] = await pool.execute<RowDataPacket[]>("SELECT * FROM trial_classes WHERE id = ?", [
    classId,
  ]);
  if (!classes[0]) throw new BookingError("NOT_FOUND", `Class ${classId} not found`);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT b.id AS booking_id, b.status, b.confirmed_at, b.created_at,
            s.id AS student_id, s.name AS student_name, s.grade,
            p.name AS parent_name, p.email AS parent_email
       FROM bookings b
       JOIN students s ON s.id = b.student_id
       JOIN parents  p ON p.id = b.parent_id
      WHERE b.class_id = ?
      ORDER BY b.confirmed_at IS NULL, b.confirmed_at, b.id`,
    [classId],
  );
  const toEntry = (r: RowDataPacket) => ({
    bookingId: r.booking_id as number,
    status: r.status as BookingStatus,
    studentId: r.student_id as number,
    studentName: r.student_name as string,
    grade: r.grade as number,
    parentName: r.parent_name as string,
    parentEmail: r.parent_email as string,
    confirmedAt: r.confirmed_at as Date | null,
    createdAt: r.created_at as Date,
  });
  return {
    class: toClass(classes[0]),
    confirmed: rows.filter((r) => r.status === "confirmed").map(toEntry),
    // Not on the roster; shown to admins for visibility only.
    other: rows.filter((r) => r.status !== "confirmed").map(toEntry),
  };
}

/**
 * Reconciliation check: the denormalised counter must equal the real number of
 * confirmed bookings, and never exceed capacity. Returns the classes that break it.
 */
export async function findInvariantViolations() {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT c.id, c.capacity, c.confirmed_count,
            (SELECT COUNT(*) FROM bookings b WHERE b.class_id = c.id AND b.status = 'confirmed') AS actual_confirmed
       FROM trial_classes c`,
  );
  return rows
    .filter((r) => r.confirmed_count !== Number(r.actual_confirmed) || r.confirmed_count > r.capacity)
    .map((r) => ({
      classId: r.id as number,
      capacity: r.capacity as number,
      confirmedCount: r.confirmed_count as number,
      actualConfirmed: Number(r.actual_confirmed),
    }));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Creates a pending_payment booking. Does NOT hold a seat: seats are only
 * claimed atomically when payment succeeds (see payBooking).
 */
export async function createBooking(input: {
  parentId: number;
  studentId: number;
  classId: number;
}): Promise<BookingDetail> {
  const pool = getPool();

  const [students] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM students WHERE id = ? AND parent_id = ?",
    [input.studentId, input.parentId],
  );
  if (!students[0]) {
    throw new BookingError("NOT_FOUND", "Student not found for this parent");
  }

  const [classes] = await pool.execute<RowDataPacket[]>(
    "SELECT id, starts_at, capacity, confirmed_count FROM trial_classes WHERE id = ?",
    [input.classId],
  );
  const cls = classes[0];
  if (!cls) throw new BookingError("NOT_FOUND", `Class ${input.classId} not found`);
  if ((cls.starts_at as Date).getTime() <= Date.now()) {
    throw new BookingError("CLASS_STARTED", "This class has already started");
  }
  // Soft check for fast feedback only. It can be stale a millisecond later;
  // the real guarantee is the conditional UPDATE at payment time.
  if (cls.confirmed_count >= cls.capacity) {
    throw new BookingError("CLASS_FULL", "This trial class is full");
  }

  try {
    const [res] = await pool.execute<ResultSetHeader>(
      "INSERT INTO bookings (class_id, student_id, parent_id, status) VALUES (?, ?, ?, 'pending_payment')",
      [input.classId, input.studentId, input.parentId],
    );
    return getBooking(res.insertId);
  } catch (err) {
    // uq_active_booking: this child already has a pending or confirmed booking for the class.
    if (isDuplicateKeyError(err)) {
      const [existing] = await pool.execute<RowDataPacket[]>(
        `SELECT id, status FROM bookings
          WHERE class_id = ? AND student_id = ? AND status IN ('pending_payment','confirmed')`,
        [input.classId, input.studentId],
      );
      throw new BookingError("ALREADY_BOOKED", "This child already has an active booking for this class", {
        existingBookingId: existing[0]?.id,
        existingStatus: existing[0]?.status,
      });
    }
    throw err;
  }
}

const RESULT_BY_PAYMENT_STATUS: Record<PaymentStatus, PayResult["result"]> = {
  processing: "processing",
  succeeded: "confirmed",
  failed: "payment_failed",
  refunded: "seat_unavailable",
};

async function replay(bookingId: number, idempotencyKey: string): Promise<PayResult | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    "SELECT booking_id, status FROM payment_attempts WHERE idempotency_key = ?",
    [idempotencyKey],
  );
  const attempt = rows[0];
  if (!attempt) return null;
  if (attempt.booking_id !== bookingId) {
    throw new BookingError("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for another booking");
  }
  return {
    result: RESULT_BY_PAYMENT_STATUS[attempt.status as PaymentStatus],
    replayed: true,
    booking: await getBooking(bookingId),
  };
}

/**
 * Records a (mock) payment and, on success, confirms the booking.
 *
 * Invariants:
 *  - At most `capacity` confirmed bookings per class, even under concurrent payments:
 *    the seat is claimed with a single conditional UPDATE on the class row.
 *  - A failed payment never touches the roster.
 *  - A successful payment that loses the last seat is refunded, and the booking
 *    becomes seat_unavailable.
 *  - The same Idempotency-Key never charges twice.
 */
export async function payBooking(input: {
  bookingId: number;
  outcome: ChargeOutcome;
  idempotencyKey: string;
  delayMs?: number;
}): Promise<PayResult> {
  const { bookingId, idempotencyKey } = input;
  const pool = getPool();

  const replayed = await replay(bookingId, idempotencyKey);
  if (replayed) return replayed;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT b.id, b.status, b.class_id, c.price_cents
       FROM bookings b JOIN trial_classes c ON c.id = b.class_id
      WHERE b.id = ?`,
    [bookingId],
  );
  const booking = rows[0];
  if (!booking) throw new BookingError("NOT_FOUND", `Booking ${bookingId} not found`);
  if (booking.status !== "pending_payment") {
    throw new BookingError("BOOKING_NOT_PENDING", `Booking is ${booking.status}, not pending_payment`, {
      status: booking.status,
    });
  }

  // 1) Claim the idempotency key BEFORE talking to the provider.
  let attemptId: number;
  try {
    const [res] = await pool.execute<ResultSetHeader>(
      "INSERT INTO payment_attempts (booking_id, idempotency_key, amount_cents, status) VALUES (?, ?, ?, 'processing')",
      [bookingId, idempotencyKey, booking.price_cents],
    );
    attemptId = res.insertId;
  } catch (err) {
    // Same key submitted concurrently: the other request owns this attempt.
    if (isDuplicateKeyError(err)) return (await replay(bookingId, idempotencyKey))!;
    throw err;
  }

  // 2) Charge outside any DB transaction: never hold row locks across a network call.
  const payment = await charge({
    amountCents: booking.price_cents,
    outcome: input.outcome,
    delayMs: input.delayMs,
  });

  // 3a) Payment failed: record it, leave the roster and seat counter alone.
  if (!payment.ok) {
    await withTransaction(async (conn) => {
      await conn.execute(
        "UPDATE bookings SET status = 'payment_failed' WHERE id = ? AND status = 'pending_payment'",
        [bookingId],
      );
      await conn.execute(
        "UPDATE payment_attempts SET status = 'failed', provider_ref = ?, failure_reason = ? WHERE id = ?",
        [payment.providerRef, payment.reason, attemptId],
      );
    });
    return { result: "payment_failed", replayed: false, booking: await getBooking(bookingId) };
  }

  // 3b) Payment succeeded: atomically claim a seat and confirm.
  const providerRef = payment.providerRef;
  const result = await withTransaction(async (conn) => {
    // The whole race is decided here. InnoDB row-locks the class row, so concurrent
    // payers serialise on this statement and the WHERE clause is re-evaluated against
    // the latest committed count. Exactly (capacity - confirmed) of them get affectedRows=1.
    const [claim] = await conn.execute<ResultSetHeader>(
      `UPDATE trial_classes
          SET confirmed_count = confirmed_count + 1
        WHERE id = ? AND confirmed_count < capacity`,
      [booking.class_id],
    );

    if (claim.affectedRows === 1) {
      const [upd] = await conn.execute<ResultSetHeader>(
        "UPDATE bookings SET status = 'confirmed', confirmed_at = NOW(3) WHERE id = ? AND status = 'pending_payment'",
        [bookingId],
      );
      if (upd.affectedRows !== 1) {
        // Booking moved on while we were charging (e.g. a second payment with a
        // different key won). Roll back the seat claim; refund below.
        throw new StaleBookingError();
      }
      await markAttempt(conn, attemptId, "succeeded", providerRef, null);
      return "confirmed" as const;
    }

    // No seat left: someone else paid first. Refund and mark the booking.
    const [upd] = await conn.execute<ResultSetHeader>(
      "UPDATE bookings SET status = 'seat_unavailable' WHERE id = ? AND status = 'pending_payment'",
      [bookingId],
    );
    // Booking already settled by a concurrent payment with another key: refund below.
    if (upd.affectedRows !== 1) throw new StaleBookingError();
    await refund(providerRef);
    await markAttempt(conn, attemptId, "refunded", providerRef, "seat_unavailable");
    return "seat_unavailable" as const;
  }).catch(async (err) => {
    if (!(err instanceof StaleBookingError)) throw err;
    await refund(providerRef);
    await pool.execute(
      "UPDATE payment_attempts SET status = 'refunded', provider_ref = ?, failure_reason = 'booking_not_pending' WHERE id = ?",
      [providerRef, attemptId],
    );
    const current = await getBooking(bookingId);
    throw new BookingError("BOOKING_NOT_PENDING", `Booking is ${current.status}; payment was refunded`, {
      status: current.status,
    });
  });

  return { result, replayed: false, booking: await getBooking(bookingId) };
}

class StaleBookingError extends Error {}

async function markAttempt(
  conn: PoolConnection,
  attemptId: number,
  status: PaymentStatus,
  providerRef: string,
  failureReason: string | null,
) {
  await conn.execute(
    "UPDATE payment_attempts SET status = ?, provider_ref = ?, failure_reason = ? WHERE id = ?",
    [status, providerRef, failureReason, attemptId],
  );
}
