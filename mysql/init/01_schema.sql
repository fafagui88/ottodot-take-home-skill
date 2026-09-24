-- Ottodot trial booking schema (MySQL 8.4 / InnoDB).
-- Re-runnable: POST /api/dev/reset and the test suite execute this file again.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS payment_attempts;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS trial_classes;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS parents;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE parents (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(190) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE students (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  parent_id  INT UNSIGNED NOT NULL,
  name       VARCHAR(100) NOT NULL,
  grade      TINYINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_parent FOREIGN KEY (parent_id) REFERENCES parents(id)
) ENGINE=InnoDB;

CREATE TABLE trial_classes (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(150) NOT NULL,
  subject         ENUM('math','science') NOT NULL,
  starts_at       DATETIME NOT NULL,
  capacity        TINYINT UNSIGNED NOT NULL DEFAULT 4,
  -- Denormalised seat counter. Only ever changed by the conditional UPDATE in payBooking().
  confirmed_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  price_cents     INT UNSIGNED NOT NULL DEFAULT 1500,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Last line of defence: the database refuses to store an overbooked class.
  CONSTRAINT chk_capacity CHECK (confirmed_count <= capacity)
) ENGINE=InnoDB;

CREATE TABLE bookings (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id          INT UNSIGNED NOT NULL,
  student_id        INT UNSIGNED NOT NULL,
  parent_id         INT UNSIGNED NOT NULL,
  status            ENUM('pending_payment','confirmed','payment_failed','seat_unavailable','cancelled')
                    NOT NULL DEFAULT 'pending_payment',
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  confirmed_at      DATETIME(3) NULL,
  -- MySQL has no partial unique index. This column is NULL for inactive bookings,
  -- and NULLs never collide in a UNIQUE index, so uq_active_booking only applies to
  -- pending_payment / confirmed rows. A child can re-book after payment_failed.
  active_student_id INT UNSIGNED AS (
                      IF(status IN ('pending_payment','confirmed'), student_id, NULL)
                    ) STORED,
  CONSTRAINT fk_bookings_class   FOREIGN KEY (class_id)   REFERENCES trial_classes(id),
  CONSTRAINT fk_bookings_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_bookings_parent  FOREIGN KEY (parent_id)  REFERENCES parents(id),
  UNIQUE KEY uq_active_booking (class_id, active_student_id),
  KEY idx_bookings_class_status (class_id, status)
) ENGINE=InnoDB;

CREATE TABLE payment_attempts (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id      INT UNSIGNED NOT NULL,
  -- Claimed BEFORE charging, so a double-click / client retry can never charge twice.
  idempotency_key VARCHAR(100) NOT NULL,
  amount_cents    INT UNSIGNED NOT NULL,
  status          ENUM('processing','succeeded','failed','refunded') NOT NULL DEFAULT 'processing',
  provider_ref    VARCHAR(100) NULL,
  failure_reason  VARCHAR(255) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  UNIQUE KEY uq_idempotency_key (idempotency_key)
) ENGINE=InnoDB;
