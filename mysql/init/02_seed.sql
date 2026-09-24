-- Synthetic demo data. Class start times are relative to NOW() so the seed never goes stale.
--
-- Edge cases covered:
--   class 1 "Intro to Robotics"  0/4 confirmed  -> seats available
--   class 2 "Fractions Fun"      3/4 confirmed  -> last-seat race demo
--   class 3 "Volcano Science"    4/4 confirmed  -> full, blocks new bookings
--   Ava (student 1) is already confirmed in Fractions Fun -> duplicate attempt
--   Noah (student 4) had a failed payment for Intro to Robotics -> payment failure case

INSERT INTO parents (id, name, email) VALUES
  (1, 'Sarah Tan',     'sarah.tan@example.com'),
  (2, 'Budi Santoso',  'budi.santoso@example.com'),
  (3, 'Priya Kumar',   'priya.kumar@example.com');

INSERT INTO students (id, parent_id, name, grade) VALUES
  (1, 1, 'Ava Tan',        4),
  (2, 1, 'Leo Tan',        2),
  (3, 1, 'Mia Tan',        6),
  (4, 2, 'Noah Santoso',   5),
  (5, 2, 'Sari Santoso',   3),
  (6, 2, 'Dimas Santoso',  4),
  (7, 3, 'Arjun Kumar',    5),
  (8, 3, 'Isha Kumar',     3),
  (9, 3, 'Rohan Kumar',    6);

INSERT INTO trial_classes (id, title, subject, starts_at, capacity, confirmed_count, price_cents) VALUES
  (1, 'Intro to Robotics', 'science', NOW() + INTERVAL 3 DAY, 4, 0, 1500),
  (2, 'Fractions Fun',     'math',    NOW() + INTERVAL 4 DAY, 4, 3, 1500),
  (3, 'Volcano Science',   'science', NOW() + INTERVAL 5 DAY, 4, 4, 1500);

INSERT INTO bookings (id, class_id, student_id, parent_id, status, confirmed_at) VALUES
  -- Fractions Fun: 3 confirmed -> 1 seat left
  (1, 2, 1, 1, 'confirmed', NOW()),
  (2, 2, 4, 2, 'confirmed', NOW()),
  (3, 2, 7, 3, 'confirmed', NOW()),
  -- Volcano Science: full
  (4, 3, 2, 1, 'confirmed', NOW()),
  (5, 3, 5, 2, 'confirmed', NOW()),
  (6, 3, 8, 3, 'confirmed', NOW()),
  (7, 3, 9, 3, 'confirmed', NOW()),
  -- Payment failure: Noah is NOT on the Intro to Robotics roster
  (8, 1, 4, 2, 'payment_failed', NULL);

INSERT INTO payment_attempts (booking_id, idempotency_key, amount_cents, status, provider_ref, failure_reason) VALUES
  (1, 'seed-1', 1500, 'succeeded', 'mock_seed_1', NULL),
  (2, 'seed-2', 1500, 'succeeded', 'mock_seed_2', NULL),
  (3, 'seed-3', 1500, 'succeeded', 'mock_seed_3', NULL),
  (4, 'seed-4', 1500, 'succeeded', 'mock_seed_4', NULL),
  (5, 'seed-5', 1500, 'succeeded', 'mock_seed_5', NULL),
  (6, 'seed-6', 1500, 'succeeded', 'mock_seed_6', NULL),
  (7, 'seed-7', 1500, 'succeeded', 'mock_seed_7', NULL),
  (8, 'seed-8', 1500, 'failed',    'mock_seed_8', 'card_declined');
