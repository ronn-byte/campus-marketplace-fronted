CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "nickname" VARCHAR(60),
    "phoneNumber" VARCHAR(25),
    "yearOfStudy" INTEGER,
    "course" VARCHAR(120),
    "bio" VARCHAR(500),
    "avatarUrl" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "profiles_userId_key"
    ON "profiles"("userId");

ALTER TABLE "profiles"
    ADD CONSTRAINT "profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
