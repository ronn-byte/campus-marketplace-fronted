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
      emailVerifiedAt: new Date(),
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
      whatsappNumber: "0712345678",
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
      whatsappNumber: "0712345678",
      yearOfStudy: 3,
      course: "Computer Science",
      bio: "Campus seller exploring the market.",
    },
  });
  assert.equal(validUpdate.statusCode, 200);
  const response = validUpdate.json();
  assert.equal(response.profile.nickname, "Campus Alex");
  assert.equal(response.profile.phoneNumber, "+254712345678");
  assert.equal(response.profile.whatsappNumber, "+254712345678");
  assert.equal(response.profile.course, "Computer Science");

  const publicProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${user.id}`,
  });
  assert.equal(publicProfile.statusCode, 200);
  assert.deepEqual(publicProfile.json().profile, {
    name: "Campus Alex",
    avatarUrl: null,
    description: "Campus seller exploring the market.",
    phoneNumber: null,
    whatsappNumber: null,
  });
  const anonymousProfileJson = JSON.stringify(publicProfile.json());
  assert.equal(anonymousProfileJson.includes(email), false);
  assert.equal(anonymousProfileJson.includes("+254712345678"), false);
  assert.equal(anonymousProfileJson.includes("0712345678"), false);

  const invalidSessionProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${user.id}`,
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=invalid-session-token` },
  });
  assert.equal(invalidSessionProfile.statusCode, 200);
  assert.deepEqual(invalidSessionProfile.json().profile, publicProfile.json().profile);

  const authenticatedSellerProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${user.id}`,
    headers: { cookie },
  });
  assert.equal(authenticatedSellerProfile.statusCode, 200);
  assert.deepEqual(authenticatedSellerProfile.json().profile, {
    name: "Campus Alex",
    avatarUrl: null,
    description: "Campus seller exploring the market.",
    phoneNumber: "+254712345678",
    whatsappNumber: "+254712345678",
  });
  assert.equal(JSON.stringify(authenticatedSellerProfile.json()).includes(email), false);

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
      whatsappNumber: "javascript:alert(1)",
      yearOfStudy: 18,
    },
  });
  assert.equal(invalidPayload.statusCode, 422);

  await cleanupUser(email);
});

test("eligible non-student sellers have public profiles while inactive accounts stay hidden", async () => {
  const email = "profile-moderator-seller@example.com";
  await cleanupUser(email);

  const seller = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("SecurePassword123!"),
      role: Role.MODERATOR,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          nickname: "Campus Moderator",
          phoneNumber: "+254712345678",
          whatsappNumber: "+254723456789",
          course: "Marketplace Operations",
        },
      },
    },
  });

  const anonymousProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${seller.id}`,
  });
  assert.equal(anonymousProfile.statusCode, 200);
  assert.deepEqual(anonymousProfile.json().profile, {
    name: "Campus Moderator",
    avatarUrl: null,
    description: null,
    phoneNumber: null,
    whatsappNumber: null,
  });

  const invalidSessionProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${seller.id}`,
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=invalid-session-token` },
  });
  assert.equal(invalidSessionProfile.statusCode, 200);
  assert.deepEqual(invalidSessionProfile.json().profile, anonymousProfile.json().profile);

  const rawToken = createOpaqueToken();
  await createSession(seller.id, hashToken(rawToken), {});
  const authenticatedProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${seller.id}`,
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=${rawToken}` },
  });
  assert.equal(authenticatedProfile.statusCode, 200);
  assert.deepEqual(authenticatedProfile.json().profile, {
    name: "Campus Moderator",
    avatarUrl: null,
    description: null,
    phoneNumber: "+254712345678",
    whatsappNumber: "+254723456789",
  });
  assert.equal(JSON.stringify(authenticatedProfile.json()).includes(email), false);

  await prisma.user.update({
    where: { id: seller.id },
    data: { accountStatus: AccountStatus.SUSPENDED },
  });
  const suspendedProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${seller.id}`,
  });
  assert.equal(suspendedProfile.statusCode, 404);

  await prisma.user.update({
    where: { id: seller.id },
    data: { accountStatus: AccountStatus.DISABLED },
  });
  const disabledProfile = await app.inject({
    method: "GET",
    url: `/api/v1/sellers/${seller.id}`,
  });
  assert.equal(disabledProfile.statusCode, 404);

  await cleanupUser(email);
});
