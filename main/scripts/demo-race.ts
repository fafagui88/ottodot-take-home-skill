/**
 * Walks through the last-seat race from the brief against the running app (full HTTP path).
 *
 *   npm run demo:race                       # defaults to http://localhost:8080
 *   BASE_URL=http://localhost:3000 npm run demo:race
 *
 * Resets demo data first (needs ALLOW_DEV_RESET=true on the server).
 */
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const FRACTIONS_FUN = 2;
const A = { parentId: 1, studentId: 3, label: "User A (Sarah → Mia)" };
const B = { parentId: 2, studentId: 5, label: "User B (Budi → Sari)" };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function seats(label: string) {
  const { data } = await call("GET", `/api/classes/${FRACTIONS_FUN}/roster`);
  console.log(`   [${label}] Fractions Fun: ${data.class.confirmedCount}/${data.class.capacity} confirmed, ${data.class.seatsLeft} seat(s) left`);
}

async function main() {
  console.log(`\nOttodot last-seat race demo against ${BASE}\n`);
  await call("POST", "/api/dev/reset");
  await seats("start");

  console.log(`\n1. ${A.label} selects the last seat and moves to payment`);
  const a = await call("POST", "/api/bookings", { parentId: A.parentId, studentId: A.studentId, classId: FRACTIONS_FUN });
  console.log(`   -> ${a.status} booking #${a.data.id} status=${a.data.status} (no seat held)`);

  console.log(`\n2. ${B.label} selects the same class`);
  const b = await call("POST", "/api/bookings", { parentId: B.parentId, studentId: B.studentId, classId: FRACTIONS_FUN });
  console.log(`   -> ${b.status} booking #${b.data.id} status=${b.data.status}`);
  await seats("after both selected");

  console.log(`\n3. ${B.label} completes payment first`);
  const bPay = await call("POST", `/api/bookings/${b.data.id}/pay`, { outcome: "success" }, { "Idempotency-Key": randomUUID() });
  console.log(`   -> result=${bPay.data.result} booking=${bPay.data.booking.status}`);
  await seats("after B paid");

  console.log(`\n4. ${A.label} then completes payment`);
  const aPay = await call("POST", `/api/bookings/${a.data.id}/pay`, { outcome: "success" }, { "Idempotency-Key": randomUUID() });
  const aAttempt = aPay.data.booking.payments.at(-1);
  console.log(`   -> result=${aPay.data.result} booking=${aPay.data.booking.status} payment=${aAttempt.status} (${aAttempt.failureReason})`);
  await seats("final");

  const roster = await call("GET", `/api/classes/${FRACTIONS_FUN}/roster`);
  console.log(`\nConfirmed roster: ${roster.data.confirmed.map((e: { studentName: string }) => e.studentName).join(", ")}`);

  const inv = await call("GET", "/api/admin/invariants");
  console.log(`Invariants OK: ${inv.data.ok}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
