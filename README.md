# Ottodot Trial Booking

A small, backend-led slice of a trial class booking system. Parents pick a child and a trial class, book it, and go through a mock payment. Admins and teachers see the roster. Each class has **4 seats**.

The focus is on correctness under the edge cases in the brief: duplicate bookings, overbooking, failed payments, and the **last-seat race**.

---

## How to run

Requirements: Docker Desktop.

```bash
cp .env.example .env          # change the passwords if you like
docker compose up --build -d  # nginx + Next.js + MySQL; the seed loads on first start
```

- App: **http://localhost:8080** (book a trial at `/`, see the roster at `/admin`)
- MySQL from the host: `127.0.0.1:3307`

> The ports are **8080** and **3307** on purpose, so the app runs next to a local XAMPP (Apache on :80/:443, MySQL on :3306) without clashing. You can change them in `.env` (`NGINX_PORT`, `MYSQL_HOST_PORT`).

### Tests

The integration tests run against the real MySQL, using a separate `ottodot_test` database that is created on MySQL's first start:

```bash
docker compose --profile test run --rm test
```

Or run them from the host with Node 22:

```bash
cd main && npm install
DATABASE_URL=mysql://ottodot:<MYSQL_PASSWORD>@127.0.0.1:3307/ottodot_test npm test
```

### Last-seat race demo (used in the video)

```bash
cd main && npm run demo:race      # calls the running app on http://localhost:8080
```

It resets the demo data and then plays the scenario from the brief over HTTP, printing the seat count after each step.

To try it in the browser instead: open two tabs. In tab A book **Fractions Fun** as *Sarah → Mia*. In tab B book it as *Budi → Sari*. Pay in B, then pay in A. A's payment is refunded. Use **Admin → Reset demo data** between runs.

### Seeded edge cases

| Case | Seed data |
|---|---|
| Class with seats available | **Intro to Robotics** (0/4) |
| Class with exactly 3 confirmed | **Fractions Fun** (3/4), used for the last-seat race |
| Full class | **Volcano Science** (4/4) |
| Duplicate booking attempt | *Sarah → Ava* is already confirmed in Fractions Fun. Booking her again returns `409 ALREADY_BOOKED` |
| Payment failure | *Budi → Noah* has a `payment_failed` booking for Robotics and is not on its roster. He can book again. |

---

## What I built

- **MySQL schema** with constraints that enforce the invariants (`mysql/init/01_schema.sql`)
- **Booking service** with the core logic (`main/src/lib/booking.ts`) and a mock payment provider (`main/src/lib/paymentMock.ts`)
- **Thin API route handlers** in Next.js (`main/src/app/api/**`)
- **Minimal UI**: a booking flow, a booking status page with mock payment buttons, and an admin roster page
- **Integration tests**, including real concurrent payments against MySQL (`main/tests/booking.test.ts`)
- **Docker setup**: `nginx` in front of `main` (Next.js standalone), plus `mysql`

```
docker-compose.yml   nginx/   mysql/init/ (schema + seed)   main/ (Next.js app, tests, demo script)
```

## Backend design

### Data model

| Table | Key columns |
|---|---|
| `parents` | id, name, email |
| `students` | id, parent_id → parents |
| `trial_classes` | id, title, starts_at, `capacity` (4), `confirmed_count`, price_cents, **`CHECK (confirmed_count <= capacity)`** |
| `bookings` | id, class_id, student_id, parent_id, `status`, confirmed_at, **`active_student_id` (generated)**, **`UNIQUE (class_id, active_student_id)`** |
| `payment_attempts` | id, booking_id, **`idempotency_key UNIQUE`**, amount_cents, status, provider_ref, failure_reason |

### Booking statuses

| Status | Meaning | On the roster? |
|---|---|---|
| `pending_payment` | Booked, waiting for payment. **No seat is held.** | no |
| `confirmed` | Payment succeeded and a seat was claimed | **yes** |
| `payment_failed` | The provider declined the payment | no (can re-book) |
| `seat_unavailable` | Payment succeeded but the class was full by then, so it was **refunded** | no |
| `cancelled` | Reserved for expiring stale pending bookings (not built, see "What I cut") | no |

Payment attempt statuses are `processing → succeeded | failed | refunded`.

### API

| Method & path | Purpose |
|---|---|
| `GET /api/parents`, `GET /api/parents/:id/students` | Mock login: pick a parent, then a child |
| `GET /api/classes` | Classes with `seatsLeft` |
| `POST /api/bookings` `{parentId, studentId, classId}` | Returns `201 pending_payment`. Errors: `409 ALREADY_BOOKED`, `409 CLASS_FULL`, `409 CLASS_STARTED`, `404` |
| `POST /api/bookings/:id/pay` `{outcome: "success"\|"fail"}` + `Idempotency-Key` header | Returns `{result: confirmed \| payment_failed \| seat_unavailable, replayed, booking}` |
| `GET /api/bookings/:id` | Booking status and its payment attempts |
| `GET /api/classes/:id/roster` | Confirmed roster, plus the other bookings for visibility |
| `GET /api/admin/invariants` | Reconciliation check: seat counters vs. confirmed bookings |
| `POST /api/dev/reset` | Reloads the seed data. Only works when `ALLOW_DEV_RESET=true` |

### How duplicates are prevented

MySQL has no partial unique index. So `bookings.active_student_id` is a **stored generated column**: it equals `student_id` while a booking is `pending_payment` or `confirmed`, and is `NULL` otherwise. `UNIQUE (class_id, active_student_id)` then allows only **one active booking per child per class**, because NULLs never collide. This check lives in the database, so it also holds when two requests arrive at the same moment (see the "8 concurrent requests" test). A child with a failed or refunded payment can book again.

### How payment failure is handled

`payBooking` first **claims the idempotency key** by inserting a `processing` attempt. Only then does it call the provider, and it does this **outside any DB transaction**. If the payment is declined, the attempt becomes `failed` and the booking becomes `payment_failed`. The seat counter and the roster are never touched. Retrying with the same key replays the stored result and never charges again. A new attempt needs a new booking, so there is a clean audit trail.

### Last-seat race: approach, why, tradeoffs

**Approach: atomic confirm at payment time, plus refund.** Booking does *not* hold a seat. When a payment succeeds, one transaction runs:

```sql
UPDATE trial_classes
   SET confirmed_count = confirmed_count + 1
 WHERE id = ? AND confirmed_count < capacity;
-- affectedRows = 1 → bookings.status = 'confirmed'  (only if it is still pending_payment)
-- affectedRows = 0 → bookings.status = 'seat_unavailable', payment refunded
```

InnoDB row-locks the class row, so concurrent payers queue up on this one statement. Each re-checks `confirmed_count < capacity` against the latest committed value. Exactly `capacity − confirmed` of them win. In the scenario from the brief, B pays first and gets the seat (3 → 4). When A's payment lands, `affectedRows = 0`, so A's booking becomes `seat_unavailable` and A's charge is refunded. If the app code were ever wrong, the `CHECK` constraint still refuses to store an overbooked class.

**Why this approach:**
- It matches the scenario in the brief: B *can* finish first, and the system must decide fairly who gets the seat. First to pay wins.
- It is one short statement with no application locks, no Redis, and no lock held across the payment call.
- It is easy to reason about and easy to test for real. The tests fire 10 payments at the last seat with `Promise.all` and assert that exactly one is confirmed.

**Tradeoffs I accepted:**
- A parent can **pay and then get refunded**. That is a worse experience than being told "sold out" up front. At 4 seats per class it is rare, and it is honest: nobody is double-booked or silently dropped. The UI says clearly what happened.
- `confirmed_count` is **denormalized**. It is only ever changed in that transaction. The tests assert after every scenario that it equals `COUNT(confirmed)`, and `/api/admin/invariants` does the same check in production.
- The alternative is a **seat hold with a TTL**: `pending_payment` would count against capacity for about 10 minutes. It gives better UX, but seats get blocked by abandoned checkouts, which hurts when there are only 4, and it needs an expiry job. It would still need the same atomic check at confirm time. I would add it as a layer on top if data showed refunds were common.

### Which checks live where

| Layer | Checks |
|---|---|
| **UI** | Disables full classes, disables the pay buttons while a request is in flight, reuses the idempotency key on a network retry. This is UX only; nothing depends on it. |
| **Backend** | The child belongs to the parent, the class has not started, a soft "is it full" check for fast feedback, allowed state transitions (only `pending_payment` can be paid), idempotency, refunding the loser. |
| **Database** (source of truth) | `UNIQUE (class_id, active_student_id)` against duplicates, the conditional `UPDATE` for seats, `CHECK (confirmed_count <= capacity)`, foreign keys, `UNIQUE idempotency_key`. |
| **Background job** (not built) | Expire `pending_payment` older than N minutes to `cancelled`. Reconcile `confirmed_count`. Retry refunds that failed. Settle `processing` attempts that are stuck. |

## Time spent

_About X hours. Fill in before submitting._

## Assumptions

- Authentication is mocked: you pick a parent in the UI. In production the parent id would come from the session, never from the request body.
- One flat trial price in a single currency. Payment is a mock provider, and the client chooses success or failure so the demo is deterministic.
- "Roster" means confirmed bookings only. Pending, failed, and refunded bookings are listed separately for admins.
- A child can have only one active booking per class. Booking several *different* classes is allowed.
- Times are stored in UTC.

## What I deliberately cut

- Real auth and roles (the admin page is open)
- A real payment provider with webhooks. The mock charges synchronously. A real integration would confirm from the webhook, using the same atomic `UPDATE`.
- Seat hold with TTL, and the expiry job for `pending_payment`
- Manual cancel and refund, and waitlists
- Regular enrollment (out of scope per the brief)
- Deadlock or serialization retry around the confirm transaction. It was not needed here, because every confirming transaction locks the same class row first.

## What I would monitor after release

- The **refund rate from `seat_unavailable`**, per class. If it is high, the seat-hold layer is needed.
- **Invariant drift**: `/api/admin/invariants` should always be `ok`. Page someone if it is not.
- `pending_payment` bookings older than N minutes, and payment attempts stuck in `processing`
- The payment failure rate by reason, and refund failures once there is a real provider
- The rate of `409 ALREADY_BOOKED` and `409 CLASS_FULL` responses, which shows UX friction
- p95 latency of the confirm transaction and lock waits on `trial_classes`

## What I would do next with more time

1. A real provider flow: create a PaymentIntent, confirm via webhook, and use an outbox for refunds so a crash between refund and commit cannot lose a refund.
2. A short seat hold (a few minutes) on top of the atomic confirm, plus the expiry job.
3. Auth with roles for parents, admins, and teachers, and a teacher-only roster endpoint.
4. A waitlist: when a seat is refunded or cancelled, offer it to the next family.
5. HTTP-level tests for the route handlers, and CI running `docker compose --profile test`.
