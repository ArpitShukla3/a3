# a3

EVE Healthcare backend assignment

A TypeScript API for diagnostic test bookings and simulated payments. It uses Fastify, PostgreSQL, SQL transactions, and JWT authentication.

## Requirements

- Node.js 24 and npm 11
- PostgreSQL 16, or Docker with Compose

## Run locally

1. Copy `.env.example` to `.env` and replace all three secrets with long random values. The example `DATABASE_URL` points to the database started by `docker compose up -d db`.
2. Run `npm ci`.
3. Load the environment and initialize the schema:

   ```bash
   set -a
   . ./.env
   set +a
   npm run migrate
   npm run dev
   ```

The API listens on port 3000 by default. `GET /health` returns `{"status":"ok"}`.

For an all-Docker run, set `JWT_SECRET`, `ADMIN_API_KEY`, and `WEBHOOK_SECRET` in `.env`, then run `docker compose up --build`. The API service runs the migration before it starts.

## API

All request and response bodies are JSON. IDs are UUIDs. Prices and booking amounts use integer paise. Dates use ISO 8601 with a timezone. Validation failures return 400 with an `error` message.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Public | Health check |
| POST | `/auth/signup` | Public | Create user |
| POST | `/auth/login` | Public | Get one-hour JWT |
| GET | `/centres` | Public | List centres |
| POST | `/centres` | `x-admin-key` | Create centre |
| GET | `/centres/:centreId/tests` | Public | List a centre's tests and prices |
| POST | `/centres/:centreId/tests` | `x-admin-key` | Add or update a test offering |
| POST | `/bookings` | Bearer JWT | Book a test |
| GET | `/bookings` | Bearer JWT | List own bookings |
| GET | `/bookings/:id` | Bearer JWT | Read own booking |
| POST | `/payments` | Bearer JWT | Simulate a payment for own booking |
| POST | `/payments/webhook` | `x-webhook-secret` | Apply provider event |

### Example flow

```bash
curl -X POST localhost:3000/auth/signup -H 'content-type: application/json' \
  -d '{"email":"patient@example.com","password":"SecurePassword123!"}'

curl -X POST localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"patient@example.com","password":"SecurePassword123!"}'
# Copy the returned token into TOKEN.

curl -X POST localhost:3000/centres -H "x-admin-key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"EVE Central","location":"Bengaluru"}'
# Copy the returned centre id into CENTRE_ID.

curl -X POST "localhost:3000/centres/$CENTRE_ID/tests" -H "x-admin-key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' -d '{"name":"CBC","pricePaise":79900}'
# Copy the returned test id into TEST_ID.

curl -X POST localhost:3000/bookings -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"centreId\":\"$CENTRE_ID\",\"testId\":\"$TEST_ID\",\"appointmentAt\":\"2027-01-01T10:00:00+05:30\"}"
# Copy the returned booking id into BOOKING_ID; choose a future appointment.

curl -X POST localhost:3000/payments -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"bookingId\":\"$BOOKING_ID\",\"outcome\":\"SUCCESS\"}"
```

To exercise the webhook instead of the mock payment endpoint, send it while the booking is still `PENDING`:

```bash
curl -X POST localhost:3000/payments/webhook -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -H 'content-type: application/json' \
  -d "{\"eventId\":\"evt-001\",\"paymentId\":\"provider-001\",\"bookingId\":\"$BOOKING_ID\",\"status\":\"SUCCESS\"}"
```

The webhook returns `paymentId`, `bookingId`, payment `status`, and `bookingStatus`. Repeating the same event and payload returns the same result. Reusing the event ID with different data or trying to change a terminal booking returns 409.

## Schema and behavior

`users` own `bookings`. `centres` and `diagnostic_tests` have a many-to-many `centre_tests` table containing each offered price. A booking references an offered centre/test pair and snapshots its amount. `payments` allows one record per booking. `webhook_events` stores an event ID, canonical payload hash, and resulting payment, so a replay can be acknowledged safely.

The mock endpoint takes an explicit `SUCCESS` or `FAILED` outcome, making the simulated result reproducible. A successful payment confirms a booking; a failed one marks it failed. Both handlers lock the booking row and update payment and booking state in a single transaction. Payment retries and cancellation are outside this small assignment's scope. Admin and webhook secrets are deployment-held shared secrets; a production service would use staff roles and provider signatures.

## Tests and checks

Start PostgreSQL and set `TEST_DATABASE_URL` if it differs from `postgres://eve:eve@localhost:5432/eve_test`, then run:

```bash
npm test
npm run typecheck
npm run build
```

Docker Compose creates the separate `eve_test` database on first initialization. For an existing Compose volume, create it once with `docker compose exec db createdb -U eve eve_test`. The integration tests truncate tables in this test database. They cover auth, catalogue permissions, ownership, validation, price snapshots, payment outcomes, webhook replay, conflicting events, and concurrent duplicate delivery.

With more time, I would add proper staff administration, provider-signed webhook requests with timestamp checks, pagination, structured request logging, observability, and a migration tool that tracks schema versions.
# a3
# a3
