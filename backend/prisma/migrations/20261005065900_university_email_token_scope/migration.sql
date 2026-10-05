CREATE TYPE "EmailVerificationPurpose" AS ENUM ('ACCOUNT_EMAIL', 'UNIVERSITY_EMAIL');

ALTER TABLE "email_verification_tokens"
  ADD COLUMN "purpose" "EmailVerificationPurpose" NOT NULL DEFAULT 'ACCOUNT_EMAIL',
  ADD COLUMN "verificationId" UUID;

CREATE UNIQUE INDEX "email_verification_tokens_verificationId_key"
  ON "email_verification_tokens"("verificationId");

ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_verificationId_fkey"
  FOREIGN KEY ("verificationId") REFERENCES "verifications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "verifications"
  ADD COLUMN "universityEmail" VARCHAR(320);
