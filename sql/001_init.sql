CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS diagnostic_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS centre_tests (
  centre_id uuid NOT NULL REFERENCES centres(id),
  test_id uuid NOT NULL REFERENCES diagnostic_tests(id),
  price_paise integer NOT NULL CHECK (price_paise > 0),
  PRIMARY KEY (centre_id, test_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  centre_id uuid NOT NULL,
  test_id uuid NOT NULL,
  appointment_at timestamptz NOT NULL,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (centre_id, test_id) REFERENCES centre_tests(centre_id, test_id)
);
CREATE INDEX IF NOT EXISTS bookings_user_id_idx ON bookings(user_id);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  provider_payment_id text UNIQUE,
  status text NOT NULL CHECK (status IN ('SUCCESS', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id text PRIMARY KEY,
  payload_hash text NOT NULL,
  payment_id uuid NOT NULL REFERENCES payments(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
