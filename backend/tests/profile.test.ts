import assert from "node:assert/strict";
import test, { after } from "node:test";
import { AccountStatus, Role, VerificationStatus } from "@prisma/client";
import "../scripts/test-database.js";

process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM = "noreply@campus-marketplace.test";
process.env.APP_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:5173";

const { env } = await import("../src/config/env.js");
const { buildApp } = await import("../src/app/app.js");
const { prisma } = await import("../src/lib/prisma.js");
const { createSession } = await import("../src/modules/auth/auth.service.js");
const { createOpaqueToken, hashPassword, hashToken } = await import("../src/modules/auth/auth.utils.js");

const app = buildApp();

async function cleanupUser(email: string) {
  await prisma.$transaction([
    prisma.profile.deleteMany({ where: { user: { email } } }),
    prisma.session.deleteMany({ where: { user: { email } } }),
    prisma.emailVerificationToken.deleteMany({ where: { user: { email } } }),
    prisma.passwordResetToken.deleteMany({ where: { user: { email } } }),
    prisma.verification.deleteMany({ where: { user: { email } } }),
    prisma.studentProfile.deleteMany({ where: { user: { email } } }),
    prisma.user.deleteMany({ where: { email } }),
  ]);
}

after(async () => {
  await app.close();
});

test("profile API requires auth and supports safe profile updates", async () => {
  const email = "profile-user@example.com";
  const password = "SecurePassword123!";
  await cleanupUser(email);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    },
  });

  const rawToken = createOpaqueToken();
  await createSession(user.id, hashToken(rawToken), {});
  const cookie = `${env.SESSION_COOKIE_NAME}=${rawToken}`;

  const unauthenticated = await app.inject({
    method: "GET",
    url: "/api/v1/profile",
  });
  assert.equal(unauthenticated.statusCode, 401);

  const me = await app.inject({
    method: "GET",
    url: "/api/v1/profile",
    headers: { cookie },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().profile.email, email);

  await prisma.studentProfile.create({
    data: {
      userId: user.id,
      displayName: "Profile User",
      verificationStatus: VerificationStatus.PENDING,
    },
  });

  const updated = await app.inject({
    method: "PATCH",
    url: "/api/v1/profile",
    headers: { cookie },
    payload: {
      nickname: "Campus Alex",
      phoneNumber: "+254712345678",
      yearOfStudy: 3,
      course: "Computer Science",
      bio: "Campus seller exploring the market.",
      role: "ADMINISTRATOR",
    },
  });
  assert.equal(updated.statusCode, 422);

  const validUpdate = await app.inject({
    method: "PATCH",
    url: "/api/v1/profile",
    headers: { cookie },
    payload: {
      nickname: "Campus Alex",
      phoneNumber: "+254712345678",
      yearOfStudy: 3,
      course: "Computer Science",
      bio: "Campus seller exploring the market.",
    },
  });
  assert.equal(validUpdate.statusCode, 200);
  const response = validUpdate.json();
  assert.equal(response.profile.nickname, "Campus Alex");
  assert.equal(response.profile.phoneNumber, "+254712345678");
  assert.equal(response.profile.course, "Computer Science");

  const persistedStudentProfile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
  });
  assert.ok(persistedStudentProfile);
  assert.equal(persistedStudentProfile.verificationStatus, VerificationStatus.PENDING);

  const invalidPayload = await app.inject({
    method: "PATCH",
    url: "/api/v1/profile",
    headers: { cookie },
    payload: {
      phoneNumber: "invalid-phone",
      yearOfStudy: 18,
    },
  });
  assert.equal(invalidPayload.statusCode, 422);

  await cleanupUser(email);
});
