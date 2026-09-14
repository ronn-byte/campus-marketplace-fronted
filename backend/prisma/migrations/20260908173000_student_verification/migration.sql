CREATE TYPE "VerificationMethod" AS ENUM ('UNIVERSITY_EMAIL', 'MANUAL_STUDENT');
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "student_profiles" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "displayName" VARCHAR(80) NOT NULL,
  "registrationNumberHash" CHAR(64),
  "registrationNumberCiphertext" TEXT,
  "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "student_profiles_userId_key" ON "student_profiles"("userId");
CREATE UNIQUE INDEX "student_profiles_registrationNumberHash_key" ON "student_profiles"("registrationNumberHash");
CREATE INDEX "student_profiles_verificationStatus_idx" ON "student_profiles"("verificationStatus");
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "verifications" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "studentProfileId" UUID,
  "method" "VerificationMethod" NOT NULL,
  "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
  "reason" VARCHAR(1000),
  "reviewedById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "reviewedAt" TIMESTAMPTZ(3),
  CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "verifications_status_method_createdAt_idx" ON "verifications"("status", "method", "createdAt");
CREATE INDEX "verifications_userId_status_idx" ON "verifications"("userId", "status");
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
