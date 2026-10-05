# Campus Marketplace Backend

The backend includes the Phase 1 foundation, the Phase 2 authentication boundary, public listings, and listing inquiries. General messaging, moderation, uploads, payments, and other marketplace workflows remain unimplemented.

## Architecture

- `src/app`: Fastify application factory and safe API errors
- `src/config`: Zod-validated environment configuration
- `src/lib`: shared infrastructure such as the Prisma client
- `src/routes`: future domain route modules
- `src/modules/auth`: password, session, verification, reset, and auth route boundaries
- `src/modules/listings`: public listing lifecycle and listing inquiry routes/services
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

### Isolated test database

Database-backed tests require `TEST_DATABASE_URL`; they do not fall back to `DATABASE_URL`. Configure it in the ignored `backend/.env` file or in the process environment, and point it to a dedicated database other than `campus_marketplace_dev`. The test setup rejects that development database name before connecting.

Create the dedicated database manually on the Azure PostgreSQL server. For an Azure Database for PostgreSQL Flexible Server, for example:

```powershell
az postgres flexible-server db create --resource-group "<RESOURCE_GROUP>" --server-name "<SERVER_NAME>" --database-name "campus_marketplace_test"
```

Replace the placeholders with the existing server's resource group and server name. Configure `TEST_DATABASE_URL` with the test database name and the same required TLS/connection options as your Azure PostgreSQL setup. The database user must be able to create the schema objects and Prisma migration table. No database is created or changed automatically by the test setup.

From `backend/`, apply the checked-in migrations to the isolated test database, then run the profile test:

```powershell
npm run prisma:migrate:test
npx tsx --test tests/profile.test.ts
```

The migration command requires `TEST_DATABASE_URL`, overrides `DATABASE_URL` only for its Prisma child process, and uses `prisma migrate deploy` (it does not create a new migration or reset data). All database-backed tests use this same explicit test database configuration.

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

### Listing inquiries

- `POST /api/v1/listings/:listingId/inquiries` requires an authenticated user but not student verification. Buyer identity is taken only from the session.
- `GET /api/v1/listings/:listingId/inquiries` requires authentication and the listing's database owner.
- Only `PUBLISHED` listings accept inquiries, matching the existing public listing collection and detail routes. `DRAFT`, `RESERVED`, `SOLD`, `SUSPENDED`, and `REMOVED` listings are unavailable for inquiry.
- Duplicate inquiries are allowed; the Prisma model has no unique constraint for a buyer/listing pair.
- New inquiries use the existing `OPEN` status. Responses and status transitions are deferred because the model has no response-message field.

## Validation commands

```text
npm run lint
npm run typecheck
npm run build
npm start
```
