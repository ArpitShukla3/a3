# EVE Healthcare TypeScript Backend Design

## Goal

Build a submission-ready backend for the EVE Healthcare intern assignment. The service lets users sign up, authenticate, browse diagnostic centres and tests, book an offered test, and settle a booking through a simulated payment or an authenticated, idempotent webhook.

## Stack and deployment

- Node.js 24, TypeScript, Fastify 5, PostgreSQL, `pg`, `bcryptjs`, and `jsonwebtoken`.
- SQL migrations run through a small TypeScript script. Docker Compose starts PostgreSQL and the API. Local Node and PostgreSQL development is also documented.
- The repository has no existing application code or Git history; build in the current workspace.

## API and access

- `POST /auth/signup` accepts email and password and creates a normal user.
- `POST /auth/login` returns a one-hour JWT. Authenticated endpoints use `Authorization: Bearer <token>`.
- `GET /centres` and `GET /centres/:centreId/tests` are public. `POST /centres` and `POST /centres/:centreId/tests` require `x-admin-key` equal to `ADMIN_API_KEY`. This small assignment uses a deployment secret instead of a full staff-management subsystem.
- `POST /bookings` creates a PENDING booking for the authenticated user, a test offered by the requested centre, and a future appointment. The server snapshots the current price in integer paise. `GET /bookings` lists only the caller's bookings; `GET /bookings/:id` returns only a booking owned by the caller.
- `POST /payments` requires user authentication and a caller-owned PENDING booking. The request supplies an explicit simulated outcome (`SUCCESS` or `FAILED`) so tests and examples are deterministic. Exactly one payment is allowed per booking. The payment and booking update commit atomically.
- `POST /payments/webhook` requires `x-webhook-secret`. It accepts `eventId`, `paymentId`, `bookingId`, and `status` (`SUCCESS` or `FAILED`). For a PENDING booking, it creates the payment and updates the booking in one transaction. Replaying the same event with the same payload returns the original outcome. Reusing an event ID with different data, reusing a payment ID for another booking, or changing a terminal booking outcome returns 409.

## Data and consistency

Tables: users, centres, diagnostic_tests, centre_tests (price), bookings, payments, and webhook_events. IDs are UUIDs. Foreign keys and uniqueness constraints protect ownership and deduplication. Booking and payment status values have database checks. A booking references its selected centre and test and stores the charged amount separately from the current catalogue price.

Payment and webhook handlers use one PostgreSQL client per transaction and lock the booking row with `FOR UPDATE`. Unique constraints on `payments.booking_id`, `payments.provider_payment_id`, and `webhook_events.event_id` close races. An event stores a canonical payload hash and its response, so a duplicate is safe to acknowledge without a second state transition.

## Errors and tests

JSON schema validates request bodies and parameters. Expected errors use 400 for invalid input, 401 for missing/invalid credentials, 403 for forbidden admin access, 404 for inaccessible resources, and 409 for state conflicts. No password hashes or secrets appear in API responses or logs.

Integration tests run against PostgreSQL and call Fastify through `inject`. They cover auth, catalogue administration and listing, booking ownership and price snapshot, simulated payment outcomes, webhook replay, conflicting events, and concurrent duplicate delivery. The README includes setup, API examples, schema, assumptions, and future improvements.
