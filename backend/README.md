# Campus Marketplace Backend

The backend includes the Phase 1 foundation and the Phase 2 authentication boundary. Listings, messaging, moderation, uploads, payments, and other marketplace workflows remain unimplemented.

## Architecture

- `src/app`: Fastify application factory and safe API errors
- `src/config`: Zod-validated environment configuration
- `src/lib`: shared infrastructure such as the Prisma client
- `src/routes`: future domain route modules
- `src/modules/auth`: password, session, verification, reset, and auth route boundaries
- `src/middleware`: reusable authentication and role middleware
- `src/server.ts`: production entry point
- `prisma/schema.prisma`: PostgreSQL schema foundation

The intended request flow is:

```text
route -> validation -> service -> Prisma -> response DTO
```

## Setup

From `backend/`:

```text
npm install
copy .env.example .env
npm run prisma:generate
npm run dev
```

On macOS/Linux, use `cp .env.example .env` instead of `copy`.

Required environment variables:

- `NODE_ENV`: `development`, `test`, or `production`
- `PORT`: API port, default `5000`
- `DATABASE_URL`: PostgreSQL connection URL
- `CORS_ORIGIN`: exact frontend origin allowed to make credentialed requests
- `SESSION_COOKIE_NAME`: opaque session cookie name; use a `__Host-` name in HTTPS production configuration
- `SESSION_TTL_HOURS`: server-side session lifetime
- `PASSWORD_RESET_TTL_MINUTES`: password reset token lifetime
- `EMAIL_VERIFICATION_TTL_HOURS`: email verification token lifetime

The server fails at startup when required values are missing or invalid.

## Database

After PostgreSQL is running and `.env` contains a valid `DATABASE_URL`:

```text
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate
```

`prisma:migrate` creates the named development migration. It does not reset or delete an existing database.

## API

Process health:

```text
GET /api/v1/health
```

Response:

```json
{"status":"ok"}
```

This endpoint checks only that the API process is running.

Authentication endpoints include registration, login, logout, `/auth/me`, email verification consumption, password reset, password change, and the frontend-compatible `/auth/session` alias. They require the authentication migration and a configured PostgreSQL database.

Sessions are opaque random cookies. Only SHA-256 session hashes are stored in PostgreSQL. Passwords use Argon2id. Email delivery is intentionally not configured yet; verification and reset tokens are generated and stored hashed, but never returned or logged.

Authentication rate limiting is bounded in memory for the single-instance development architecture. A shared rate-limit store is required before horizontal production scaling.

## Validation commands

```text
npm run lint
npm run typecheck
npm run build
npm start
```
