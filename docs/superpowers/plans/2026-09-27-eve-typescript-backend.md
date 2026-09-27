# EVE Healthcare TypeScript Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the TypeScript/PostgreSQL backend described in the EVE assignment.

**Architecture:** Fastify routes validate inputs and delegate state changes to a PostgreSQL-backed service. SQL constraints and transactions protect payment and webhook state. API integration tests exercise the real database.

**Tech Stack:** Node.js 24, TypeScript, Fastify 5, PostgreSQL, `pg`, `bcryptjs`, `jsonwebtoken`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-27-eve-typescript-backend-design.md`

## Global Constraints

- Keep all monetary values as integer paise.
- Only a deployment-held admin key may change catalogue data.
- Only the booking owner may see or pay for a booking.
- A booking can receive one terminal payment outcome.
- Webhook duplicate acknowledgement must be safe under concurrent requests.

## Review Focus

- A test ID offered at another centre must be rejected when booking.
- A catalogue price change after booking must not change the booked amount.
- Two deliveries of the same webhook event must create one payment and one event record.
- An event ID reused with a different payload must return 409.
- A second payment outcome must not reverse a terminal booking.

---

### Task 1: Project and database foundation

**Files:** `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `Dockerfile`, `docker-compose.yml`, `sql/001_init.sql`, `src/config.ts`, `src/db.ts`, `src/migrate.ts`, `test/db.test.ts`.

**Interfaces:** `createPool(connectionString: string): Pool`; `migrate(pool: Pool): Promise<void>`; configuration includes `DATABASE_URL`, `JWT_SECRET`, `ADMIN_API_KEY`, `WEBHOOK_SECRET`, and `PORT`.

- [ ] Write a failing database test that migrates a clean database and checks all seven tables and the one-payment-per-booking constraint.
- [ ] Run the test and confirm it fails because migration code is missing.
- [ ] Add dependencies, SQL constraints, pool creation, migration runner, and Docker configuration.
- [ ] Run the database test until it passes; run TypeScript checking.

### Task 2: Authentication and catalogue

**Files:** `src/app.ts`, `src/auth.ts`, `src/routes/auth.ts`, `src/routes/catalogue.ts`, `test/api.test.ts`.

**Interfaces:** `buildApp(pool: Pool, config: Config): FastifyInstance`; auth helper validates bearer JWT and returns user ID; catalogue stores centre tests with price in paise.

- [ ] Add failing API tests for signup/login, duplicate email, admin-only centre/test creation, and public listing.
- [ ] Run the selected tests and confirm the routes are absent.
- [ ] Implement validation, password hashing, JWT issuance/verification, catalogue routes, and error responses.
- [ ] Run the selected tests and the full suite; typecheck.

### Task 3: Bookings

**Files:** `src/routes/bookings.ts`, `test/api.test.ts`.

**Interfaces:** `POST /bookings`, `GET /bookings`, `GET /bookings/:id` with owner scoping and immutable amount snapshot.

- [ ] Add failing tests for valid booking, foreign-centre test, past appointment, owner-only reads, and price snapshot.
- [ ] Run the selected tests and confirm expected failures.
- [ ] Implement booking routes with parameterized SQL and owner filtering.
- [ ] Run selected tests and full suite; typecheck.

### Task 4: Mock payment and idempotent webhook

**Files:** `src/payments.ts`, `src/routes/payments.ts`, `test/api.test.ts`.

**Interfaces:** transactional `settleBooking(...)`; `POST /payments`; `POST /payments/webhook`.

- [ ] Add failing tests for success and failure, unauthorized payment, replay, conflicting payload, conflicting terminal status, and concurrent webhook duplicates.
- [ ] Run selected tests and confirm failures are for missing behavior.
- [ ] Implement transaction-bound row locking, unique payment/event IDs, replay comparison, and mapped API errors.
- [ ] Run selected tests and full suite; typecheck.

### Task 5: Submission documentation and final verification

**Files:** `README.md`, `src/server.ts`, package scripts.

- [ ] Add an end-to-end smoke test for health and startup configuration.
- [ ] Run it and confirm expected failure.
- [ ] Document local and Docker setup, routes with sample requests, schema, assumptions, and future work; add server entry point.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and a Docker smoke check. Review the assignment requirements against the implementation.
