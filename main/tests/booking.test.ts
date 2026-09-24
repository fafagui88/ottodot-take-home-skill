import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBooking,
  findInvariantViolations,
  getBooking,
  getRoster,
  payBooking,
} from "@/lib/booking";
import { closePool, getPool } from "@/lib/db";
import {
  addStudents,
  CLASS,
  confirmedCount,
  expectBookingError,
  key,
  PARENT,
  resetTestDb,
  STUDENT,
} from "./helpers";

beforeEach(async () => {
  await resetTestDb();
});

afterEach(async () => {
  // Every scenario must leave seat counters consistent with the confirmed roster.
  expect(await findInvariantViolations()).toEqual([]);
});

afterAll(async () => {
  await closePool();
});

describe("seed data", () => {
  it("covers the required cases", async () => {
    expect(await confirmedCount(CLASS.robotics)).toBe(0);
    expect(await confirmedCount(CLASS.fractions)).toBe(3);
    expect(await confirmedCount(CLASS.volcano)).toBe(4);
    const failed = await getBooking(8);
    expect(failed.status).toBe("payment_failed");
    expect(failed.payments[0].status).toBe("failed");
  });
});

describe("happy path", () => {
  it("book -> pay success -> confirmed and on the roster", async () => {
    const booking = await createBooking({ parentId: PARENT.sarah, studentId: STUDENT.leo, classId: CLASS.robotics });
    expect(booking.status).toBe("pending_payment");
    // Booking alone does not take a seat.
    expect(await confirmedCount(CLASS.robotics)).toBe(0);

    const paid = await payBooking({ bookingId: booking.id, outcome: "success", idempotencyKey: key() });
    expect(paid.result).toBe("confirmed");
    expect(paid.booking.status).toBe("confirmed");
    expect(paid.booking.payments.map((p) => p.status)).toEqual(["succeeded"]);

    const roster = await getRoster(CLASS.robotics);
    expect(roster.confirmed.map((e) => e.studentId)).toEqual([STUDENT.leo]);
    expect(roster.class.seatsLeft).toBe(3);
  });
});

describe("duplicate bookings", () => {
  it("rejects a second booking when the child is already confirmed (seeded Ava in Fractions Fun)", async () => {
    const err = await expectBookingError(
      createBooking({ parentId: PARENT.sarah, studentId: STUDENT.ava, classId: CLASS.fractions }),
      "ALREADY_BOOKED",
    );
    expect(err.details?.existingBookingId).toBe(1);
  });

  it("rejects a second booking while the first is still pending_payment", async () => {
    await createBooking({ parentId: PARENT.sarah, studentId: STUDENT.leo, classId: CLASS.robotics });
    await expectBookingError(
      createBooking({ parentId: PARENT.sarah, studentId: STUDENT.leo, classId: CLASS.robotics }),
      "ALREADY_BOOKED",
    );
  });

  it("allows only one of many concurrent booking requests for the same child", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        createBooking({ parentId: PARENT.sarah, studentId: STUDENT.leo, classId: CLASS.robotics }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason.code).toBe("ALREADY_BOOKED");
    }
  });

  it("allows re-booking after a failed payment (seeded Noah)", async () => {
    const again = await createBooking({ parentId: PARENT.budi, studentId: STUDENT.noah, classId: CLASS.robotics });
    expect(again.status).toBe("pending_payment");
  });
});

describe("payment failure", () => {
  it("marks payment_failed and never touches the roster or seat counter", async () => {
    const booking = await createBooking({ parentId: PARENT.budi, studentId: STUDENT.sari, classId: CLASS.fractions });
    const res = await payBooking({ bookingId: booking.id, outcome: "fail", idempotencyKey: key() });

    expect(res.result).toBe("payment_failed");
    expect(res.booking.status).toBe("payment_failed");
    expect(res.booking.payments.map((p) => [p.status, p.failureReason])).toEqual([["failed", "card_declined"]]);
    expect(await confirmedCount(CLASS.fractions)).toBe(3);
    const roster = await getRoster(CLASS.fractions);
    expect(roster.confirmed.map((e) => e.studentId)).not.toContain(STUDENT.sari);
  });

  it("does not let a failed booking be paid again; the parent books again instead", async () => {
    const booking = await createBooking({ parentId: PARENT.budi, studentId: STUDENT.sari, classId: CLASS.fractions });
    await payBooking({ bookingId: booking.id, outcome: "fail", idempotencyKey: key() });
    await expectBookingError(
      payBooking({ bookingId: booking.id, outcome: "success", idempotencyKey: key() }),
      "BOOKING_NOT_PENDING",
    );

    const retry = await createBooking({ parentId: PARENT.budi, studentId: STUDENT.sari, classId: CLASS.fractions });
    const res = await payBooking({ bookingId: retry.id, outcome: "success", idempotencyKey: key() });
    expect(res.result).toBe("confirmed");
  });
});

describe("overbooking", () => {
  it("rejects new bookings for a full class", async () => {
    await expectBookingError(
      createBooking({ parentId: PARENT.sarah, studentId: STUDENT.mia, classId: CLASS.volcano }),
      "CLASS_FULL",
    );
  });

  it("refunds a successful payment when the class filled up after booking", async () => {
    // Simulate a booking created while the class still had seats.
    const [res] = await getPool().execute(
      "INSERT INTO bookings (class_id, student_id, parent_id, status) VALUES (?, ?, ?, 'pending_payment')",
      [CLASS.volcano, STUDENT.mia, PARENT.sarah],
    );
    const bookingId = (res as { insertId: number }).insertId;

    const paid = await payBooking({ bookingId, outcome: "success", idempotencyKey: key() });
    expect(paid.result).toBe("seat_unavailable");
    expect(paid.booking.status).toBe("seat_unavailable");
    expect(paid.booking.payments[0]).toMatchObject({ status: "refunded", failureReason: "seat_unavailable" });
    expect(await confirmedCount(CLASS.volcano)).toBe(4);
  });

  it("database CHECK constraint refuses confirmed_count > capacity even if app code is wrong", async () => {
    await expect(
      getPool().execute("UPDATE trial_classes SET confirmed_count = confirmed_count + 1 WHERE id = ?", [CLASS.volcano]),
    ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  });
});

describe("last-seat race", () => {
  it("scenario from the brief: A selects, B selects, B pays first, then A pays", async () => {
    // Fractions Fun has 3/4 confirmed -> one seat left.
    const a = await createBooking({ parentId: PARENT.sarah, studentId: STUDENT.mia, classId: CLASS.fractions });
    const b = await createBooking({ parentId: PARENT.budi, studentId: STUDENT.sari, classId: CLASS.fractions });

    const bPaid = await payBooking({ bookingId: b.id, outcome: "success", idempotencyKey: key("B") });
    expect(bPaid.result).toBe("confirmed");

    const aPaid = await payBooking({ bookingId: a.id, outcome: "success", idempotencyKey: key("A") });
    expect(aPaid.result).toBe("seat_unavailable");
    expect(aPaid.booking.payments[0].status).toBe("refunded");

    const roster = await getRoster(CLASS.fractions);
    expect(roster.confirmed).toHaveLength(4);
    expect(roster.confirmed.map((e) => e.studentId)).toContain(STUDENT.sari);
    expect(roster.confirmed.map((e) => e.studentId)).not.toContain(STUDENT.mia);
    expect(roster.class.seatsLeft).toBe(0);
  });

  it("10 parents paying for the last seat at the same moment -> exactly 1 confirmed", async () => {
    const kids = await addStudents(PARENT.priya, 10);
    const bookings = await Promise.all(
      kids.map((studentId) => createBooking({ parentId: PARENT.priya, studentId, classId: CLASS.fractions })),
    );

    const results = await Promise.all(
      bookings.map((b) => payBooking({ bookingId: b.id, outcome: "success", idempotencyKey: key("par") })),
    );

    expect(results.filter((r) => r.result === "confirmed")).toHaveLength(1);
    expect(results.filter((r) => r.result === "seat_unavailable")).toHaveLength(9);
    expect(await confirmedCount(CLASS.fractions)).toBe(4);
    expect((await getRoster(CLASS.fractions)).confirmed).toHaveLength(4);
  });

  it("10 concurrent payers for an empty class -> exactly 4 confirmed", async () => {
    const kids = await addStudents(PARENT.priya, 10);
    const bookings = await Promise.all(
      kids.map((studentId) => createBooking({ parentId: PARENT.priya, studentId, classId: CLASS.robotics })),
    );
    const results = await Promise.all(
      bookings.map((b) => payBooking({ bookingId: b.id, outcome: "success", idempotencyKey: key("par") })),
    );

    expect(results.filter((r) => r.result === "confirmed")).toHaveLength(4);
    expect(results.filter((r) => r.result === "seat_unavailable")).toHaveLength(6);
    expect(await confirmedCount(CLASS.robotics)).toBe(4);
  });
});

describe("idempotency", () => {
  it("replays the stored result for the same Idempotency-Key and charges once", async () => {
    const booking = await createBooking({ parentId: PARENT.sarah, studentId: STUDENT.leo, classId: CLASS.robotics });
    const k = key("dbl");

    const first = await payBooking({ bookingId: booking.id, outcome: "success", idempotencyKey: k });
    const second = await payBooking({ bookingId: booking.id, outcome: "success", idempotencyKey: k });

    expect(first).toMatchObject({ result: "confirmed", replayed: false });
    expect(second).toMatchObject({ result: "confirmed", replayed: true });
    expect(second.booking.payments).toHaveLength(1);
    expect(await confirmedCount(CLASS.robotics)).toBe(1);
  });

  it("double-click (same key, concurrent) creates one payment attempt", async () => {
    const booking = await createBooking({ parentId: PARENT.sarah, studentId: STUDENT.leo, classId: CLASS.robotics });
    const k = key("click");
    await Promise.all([
      payBooking({ bookingId: booking.id, outcome: "success", idempotencyKey: k }),
      payBooking({ bookingId: booking.id, outcome: "success", idempotencyKey: k }),
    ]);
    const final = await getBooking(booking.id);
    expect(final.status).toBe("confirmed");
    expect(final.payments).toHaveLength(1);
    expect(await confirmedCount(CLASS.robotics)).toBe(1);
  });

  it("two concurrent payments with different keys confirm once; the extra charge is refunded", async () => {
    const booking = await createBooking({ parentId: PARENT.sarah, studentId: STUDENT.leo, classId: CLASS.robotics });
    await Promise.allSettled([
      payBooking({ bookingId: booking.id, outcome: "success", idempotencyKey: key("x") }),
      payBooking({ bookingId: booking.id, outcome: "success", idempotencyKey: key("y") }),
    ]);
    const final = await getBooking(booking.id);
    expect(final.status).toBe("confirmed");
    expect(final.payments.filter((p) => p.status === "succeeded")).toHaveLength(1);
    expect(final.payments.every((p) => p.status === "succeeded" || p.status === "refunded")).toBe(true);
    expect(await confirmedCount(CLASS.robotics)).toBe(1);
  });

  it("same booking paid twice concurrently for the LAST seat: stays confirmed, extra charge refunded", async () => {
    const booking = await createBooking({ parentId: PARENT.sarah, studentId: STUDENT.mia, classId: CLASS.fractions });
    const results = await Promise.allSettled([
      payBooking({ bookingId: booking.id, outcome: "success", idempotencyKey: key("l1") }),
      payBooking({ bookingId: booking.id, outcome: "success", idempotencyKey: key("l2") }),
    ]);
    // Neither response may claim the seat was lost when this booking actually got it.
    for (const r of results) {
      if (r.status === "fulfilled") expect(r.value.result).toBe("confirmed");
      else expect(r.reason.code).toBe("BOOKING_NOT_PENDING");
    }
    const final = await getBooking(booking.id);
    expect(final.status).toBe("confirmed");
    expect(final.payments.filter((p) => p.status === "succeeded")).toHaveLength(1);
    expect(await confirmedCount(CLASS.fractions)).toBe(4);
  });

  it("rejects reusing a key for a different booking", async () => {
    const b1 = await createBooking({ parentId: PARENT.sarah, studentId: STUDENT.leo, classId: CLASS.robotics });
    const b2 = await createBooking({ parentId: PARENT.sarah, studentId: STUDENT.mia, classId: CLASS.robotics });
    const k = key("reuse");
    await payBooking({ bookingId: b1.id, outcome: "success", idempotencyKey: k });
    await expectBookingError(
      payBooking({ bookingId: b2.id, outcome: "success", idempotencyKey: k }),
      "IDEMPOTENCY_KEY_REUSED",
    );
  });
});

describe("validation", () => {
  it("rejects booking a child that does not belong to the parent", async () => {
    await expectBookingError(
      createBooking({ parentId: PARENT.sarah, studentId: STUDENT.noah, classId: CLASS.robotics }),
      "NOT_FOUND",
    );
  });

  it("rejects paying an already confirmed booking", async () => {
    await expectBookingError(
      payBooking({ bookingId: 1, outcome: "success", idempotencyKey: key() }),
      "BOOKING_NOT_PENDING",
    );
  });
});
