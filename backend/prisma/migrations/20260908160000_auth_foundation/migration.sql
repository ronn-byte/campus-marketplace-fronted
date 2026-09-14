-- Authentication foundation migration. Apply with Prisma migrate deploy/dev.
ALTER TYPE "AccountStatus" RENAME TO "AccountStatus_old";
CREATE TYPE "AccountStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DISABLED');
ALTER TABLE "users" ALTER COLUMN "accountStatus" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "accountStatus" TYPE "AccountStatus" USING (
  CASE "accountStatus"::text
    WHEN 'DEACTIVATED' THEN 'DISABLED'::"AccountStatus"
    ELSE "accountStatus"::text::"AccountStatus"
  END
);
ALTER TABLE "users" ALTER COLUMN "accountStatus" SET DEFAULT 'PENDING_VERIFICATION';
DROP TYPE "AccountStatus_old";

ALTER TABLE "users"
  ADD COLUMN "passwordHash" VARCHAR(255) NOT NULL DEFAULT 'migration-required',
  ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3);
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP DEFAULT;

CREATE TABLE "sessions" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "sessionHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "ipAddress" INET,
  "userAgent" VARCHAR(512),
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sessions_sessionHash_key" ON "sessions"("sessionHash");
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "email_verification_tokens" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMPTZ(3),
  CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");
CREATE INDEX "email_verification_tokens_userId_consumedAt_idx" ON "email_verification_tokens"("userId", "consumedAt");
CREATE INDEX "email_verification_tokens_expiresAt_idx" ON "email_verification_tokens"("expiresAt");
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "password_reset_tokens" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMPTZ(3),
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");
CREATE INDEX "password_reset_tokens_userId_consumedAt_idx" ON "password_reset_tokens"("userId", "consumedAt");
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing users must be assigned a real Argon2id hash before authentication is enabled.
UPDATE "users" SET "passwordHash" = 'migration-required';
