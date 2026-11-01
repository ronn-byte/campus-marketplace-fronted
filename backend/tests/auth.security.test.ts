import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import {
  AccountStatus,
  EmailVerificationPurpose,
  VerificationMethod,
  VerificationStatus,
} from "@prisma/client";

import "../scripts/test-database.js";

process.env.EMAIL_PROVIDER = "resend";
process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM = "noreply@campus-marketplace.test";
process.env.APP_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.STUDENT_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");

const sendCalls: Array<{ to: string; subject: string }> = [];
const { emailTransport } = await import("../src/lib/email.js");
const originalSend = emailTransport.send;

before(() => {
  emailTransport.send = async (message) => {
    sendCalls.push({
      to: message.to,
      subject: message.subject,
    });
  };
});

after(() => {
  emailTransport.send = originalSend;
  sendCalls.length = 0;
});

const { prisma } = await import("../src/lib/prisma.js");
const { buildApp } = await import("../src/app/app.js");
const {
  authenticate,
  register,
  createSession,
  getSessionUser,
  revokeSession,
  changePassword,
  requestPasswordReset,
  resetPassword,
  reconcileAccountForLogin,
  verifyEmail,
} = await import("../src/modules/auth/auth.service.js");
const { assertSellerAuthorized } = await import("../src/modules/verification/verification.service.js");
const { hashToken, createOpaqueToken } = await import("../src/modules/auth/auth.utils.js");
const { AppError } = await import("../src/app/errors.js");
const app = buildApp();

async function cleanupTestUser(email: string) {
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { user: { email } } }),
    prisma.emailVerificationToken.deleteMany({ where: { user: { email } } }),
    prisma.passwordResetToken.deleteMany({ where: { user: { email } } }),
    prisma.verification.deleteMany({ where: { user: { email } } }),
    prisma.studentProfile.deleteMany({ where: { user: { email } } }),
    prisma.user.deleteMany({ where: { email } }),
  ]);
}

test("ordinary registration creates no student records and remains usable when email delivery fails", async () => {
  const email = "test-registration-email-delivery-failure@example.com";
  await cleanupTestUser(email);

  const previousSend = emailTransport.send;
  let attemptedToken: string | undefined;
  emailTransport.send = async (message) => {
    const html = message.html;
    const tokenMatch = html.match(/verify-email\?token=([^"&]+)/);
    attemptedToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : undefined;
    throw new Error("Email provider rejected recipient");
  };

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email,
        password: "test-password-12345",
        displayName: "Test User",
      },
    });

    assert.equal(response.statusCode, 201);
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        profile: true,
        studentProfile: true,
        verificationsSubmitted: true,
        verificationTokens: true,
      },
    });
    assert.ok(user);
    assert.equal(user.accountStatus, AccountStatus.ACTIVE);
    assert.equal(user.emailVerifiedAt, null);
    assert.equal(user.profile?.nickname, "Test User");
    assert.equal(user.studentProfile, null);
    assert.equal(user.verificationsSubmitted.length, 0);
    assert.equal(user.verificationTokens.length, 1);
    assert.equal(user.verificationTokens[0]?.purpose, EmailVerificationPurpose.ACCOUNT_EMAIL);
    assert.ok(attemptedToken);
    assert.equal(user.verificationTokens[0]?.tokenHash, hashToken(attemptedToken));
    assert.notEqual(user.verificationTokens[0]?.tokenHash, attemptedToken);

    const login = await authenticate({
      email,
      identifier: undefined,
      password: "test-password-12345",
    });
    assert.equal(login.user.email, email);
    await assert.rejects(
      () => assertSellerAuthorized(user.id),
      (error: unknown) => error instanceof AppError && error.code === "SELLER_EMAIL_UNVERIFIED",
    );

    await verifyEmail(attemptedToken);
    const verified = await prisma.user.findUnique({ where: { id: user.id } });
    assert.ok(verified?.emailVerifiedAt);
    await assert.rejects(
      () => verifyEmail(attemptedToken),
      (error: unknown) => error instanceof AppError && error.code === "INVALID_VERIFICATION_TOKEN",
    );
  } finally {
    emailTransport.send = previousSend;
    await cleanupTestUser(email);
  }
});

test("resend-confirmation and password-reset delivery failures keep generic responses", async () => {
  const email = `test-email-delivery-failure-${randomUUID()}@example.test`;
  await cleanupTestUser(email);
  const user = await register({
    email,
    password: "test-password-12345",
    displayName: "Test User",
  });
  const previousSend = emailTransport.send;
  const previousConsoleError = console.error;
  const loggedErrors: string[] = [];
  emailTransport.send = async () => {
    throw new Error("smtp-secret-and-email-token");
  };
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args.map(String).join(" "));
  };

  try {
    const resendResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resend-verification",
      remoteAddress: "192.0.2.91",
      payload: { email },
    });
    assert.equal(resendResponse.statusCode, 202);
    assert.deepEqual(resendResponse.json(), {
      message: "If the account is eligible, verification instructions will be sent shortly.",
    });

    const resetResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      remoteAddress: "192.0.2.92",
      payload: { email },
    });
    assert.equal(resetResponse.statusCode, 202);
    assert.deepEqual(resetResponse.json(), {
      message: "If the account exists, password reset instructions will be sent shortly.",
    });

    assert.equal(
      await prisma.emailVerificationToken.count({ where: { userId: user.id } }),
      2,
    );
    assert.equal(
      await prisma.passwordResetToken.count({ where: { userId: user.id } }),
      1,
    );
    assert.doesNotMatch(loggedErrors.join(" "), /smtp-secret|email-token/);
  } finally {
    emailTransport.send = previousSend;
    console.error = previousConsoleError;
    await cleanupTestUser(email);
  }
});

test("password reset revokes active sessions and accepts the new password", async () => {
  const email = `test-password-reset-session-revocation-${randomUUID()}@example.test`;
  await cleanupTestUser(email);

  try {
    const user = await register({
      email,
      password: "original-password-12345",
      displayName: "Test User",
    });
    const sessionHash = hashToken(createOpaqueToken());
    await createSession(user.id, sessionHash, {});
    assert.ok(await getSessionUser(sessionHash));

    const resetToken = createOpaqueToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(resetToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const newPassword = "new-password-1234567";
    await resetPassword({ token: resetToken, password: newPassword });

    assert.equal(await getSessionUser(sessionHash), null);
    const authenticated = await authenticate({
      email,
      identifier: undefined,
      password: newPassword,
    });
    assert.equal(authenticated.user.email, email);
  } finally {
    await cleanupTestUser(email);
  }
});

test("duplicate registration email returns a conflict without creating another account", async () => {
  const email = "test-registration-duplicate@example.com";
  await cleanupTestUser(email);

  try {
    await register({
      email,
      password: "test-password-12345",
      displayName: "Test User",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email,
        password: "another-test-password-12345",
        displayName: "Duplicate User",
      },
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json().error, {
      code: "EMAIL_ALREADY_EXISTS",
      message: "An account with this email already exists. Please log in or reset your password.",
    });

    assert.equal(await prisma.user.count({ where: { email } }), 1);
  } finally {
    await cleanupTestUser(email);
  }
});

test("verification resend is rate limited by IP and normalized email", async () => {
  const runId = randomUUID();
  const email = `test-resend-throttle-${runId}@example.com`;
  const addressId = runId.replaceAll("-", "");
  const remoteAddress = `2001:db8:${addressId.slice(0, 4)}:${addressId.slice(4, 8)}:${addressId.slice(8, 12)}:${addressId.slice(12, 16)}::1`;
  await cleanupTestUser(email);
  try {
    await register({ email, password: "test-password-12345", displayName: "Test User" });
    const responses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.push(await app.inject({
        method: "POST",
        url: "/api/v1/auth/resend-verification",
        remoteAddress,
        payload: { email: email.toUpperCase() },
      }));
    }
    assert.deepEqual(responses.map((response) => response.statusCode), [202, 202, 202, 429]);
    assert.equal(responses[3]?.json().error.code, "AUTH_RATE_LIMITED");
  } finally {
    await cleanupTestUser(email);
  }
});

test("Authentication: unauthenticated request", async () => {
  try {
    await authenticate({
      email: "nonexistent@example.com",
      identifier: undefined,
      password: "some-password-12345",
    });
    assert.fail("Should have thrown INVALID_CREDENTIALS");
  } catch (error) {
    if (error instanceof AppError) {
      assert.equal(error.code, "INVALID_CREDENTIALS");
    } else {
      throw error;
    }
  }
});

test("Authentication: invalid credentials returns generic error", async (t) => {
  await t.test("user exists but wrong password", async () => {
    const email = "test-auth-wrong-pw@example.com";
    await cleanupTestUser(email);

    await register({
      email,
      password: "correct-password-123",
      displayName: "Test User",
    });

    // Approve the account
    const verification = await prisma.verification.findFirst({
      where: { user: { email } },
    });
    if (verification) {
      await prisma.user.update({
        where: { email },
        data: { accountStatus: AccountStatus.ACTIVE },
      });
    }

    try {
      await authenticate({
        email,
        identifier: undefined,
        password: "wrong-password-12345",
      });
      assert.fail("Should have thrown INVALID_CREDENTIALS");
    } catch (error) {
      if (error instanceof AppError) {
        assert.equal(error.code, "INVALID_CREDENTIALS");
        assert.equal(error.message, "Unable to sign in with those credentials.");
      } else {
        throw error;
      }
    } finally {
      await cleanupTestUser(email);
    }
  });

  await t.test("active account remains login-eligible while student verification is pending", async () => {
    const email = "test-auth-manual-verification@example.com";
    await cleanupTestUser(email);

    await register({
      email,
      password: "test-password-12345",
      displayName: "Test User",
    });

    const result = await authenticate({
      email,
      identifier: undefined,
      password: "test-password-12345",
    });

    assert.equal(result.user.email, email);
    assert.equal(result.user.accountStatus, AccountStatus.ACTIVE);
    await cleanupTestUser(email);
  });

  await t.test("legacy pending accounts are reconciled after valid login", async () => {
    const email = "test-auth-legacy-pending@example.com";
    await cleanupTestUser(email);

    const legacyUser = await register({
      email,
      password: "test-password-12345",
      displayName: "Legacy User",
    });
    const legacyProfile = await prisma.studentProfile.create({
      data: {
        userId: legacyUser.id,
        displayName: "Historical Student",
        verificationStatus: VerificationStatus.PENDING,
        registrationNumberHash: "a".repeat(64),
      },
    });
    await prisma.verification.create({
      data: {
        userId: legacyUser.id,
        studentProfileId: legacyProfile.id,
        method: VerificationMethod.MANUAL_STUDENT,
        status: VerificationStatus.PENDING,
      },
    });
    const profileBefore = await prisma.studentProfile.findUnique({
      where: { userId: legacyUser.id },
      select: { id: true, verificationStatus: true, registrationNumberHash: true, registrationNumberCiphertext: true },
    });
    const verificationsBefore = await prisma.verification.findMany({
      where: { user: { email } },
      select: { id: true, studentProfileId: true, method: true, status: true, reason: true, createdAt: true },
    });
    await prisma.user.update({
      where: { email },
      data: { accountStatus: AccountStatus.PENDING_VERIFICATION },
    });

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email,
          password: "test-password-12345",
        },
      });

      assert.equal(login.statusCode, 200);
      assert.equal(login.json().user.accountStatus, AccountStatus.ACTIVE);
      assert.equal(
        (await prisma.user.findUnique({ where: { email } }))?.accountStatus,
        AccountStatus.ACTIVE,
      );

      const setCookie = login.headers["set-cookie"];
      const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      assert.ok(cookie);
      const session = await app.inject({
        method: "GET",
        url: "/api/v1/auth/session",
        headers: { cookie: cookie.split(";", 1)[0] },
      });
      assert.equal(session.statusCode, 200);
      assert.equal(session.json().user.accountStatus, AccountStatus.ACTIVE);
      assert.equal(session.json().user.email, email);

      const profileAfter = await prisma.studentProfile.findUnique({
        where: { userId: legacyUser.id },
        select: { id: true, verificationStatus: true, registrationNumberHash: true, registrationNumberCiphertext: true },
      });
      const verificationsAfter = await prisma.verification.findMany({
        where: { user: { email } },
        select: { id: true, studentProfileId: true, method: true, status: true, reason: true, createdAt: true },
      });
      assert.deepEqual(profileAfter, profileBefore);
      assert.deepEqual(verificationsAfter, verificationsBefore);
    } finally {
      await cleanupTestUser(email);
    }
  });

  for (const accountStatus of [AccountStatus.SUSPENDED, AccountStatus.DISABLED]) {
    await t.test(`${accountStatus} account returns generic error`, async () => {
      const email = `test-auth-${accountStatus.toLowerCase()}@example.com`;
      await cleanupTestUser(email);

      await register({
        email,
        password: "test-password-12345",
        displayName: "Test User",
      });

      await prisma.user.update({
        where: { email },
        data: { accountStatus },
      });

      try {
        await authenticate({
          email,
          identifier: undefined,
          password: "test-password-12345",
        });
        assert.fail("Should have thrown INVALID_CREDENTIALS");
      } catch (error) {
        if (error instanceof AppError) {
          assert.equal(error.code, "INVALID_CREDENTIALS");
        } else {
          throw error;
        }
      } finally {
        await cleanupTestUser(email);
      }
    });
  }
});

for (const accountStatus of [AccountStatus.SUSPENDED, AccountStatus.DISABLED]) {
  test(`concurrent ${accountStatus.toLowerCase()} cannot be overwritten by pending-account reconciliation`, async () => {
    const email = `test-auth-race-${accountStatus.toLowerCase()}@example.com`;
    await cleanupTestUser(email);

    const user = await register({
      email,
      password: "test-password-12345",
      displayName: "Race User",
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: AccountStatus.PENDING_VERIFICATION },
    });

    try {
      const [reconciliation, moderation] = await Promise.allSettled([
        reconcileAccountForLogin(user.id),
        prisma.user.update({
          where: { id: user.id },
          data: { accountStatus },
        }),
      ]);

      assert.equal(moderation.status, "fulfilled");
      if (reconciliation.status === "rejected") {
        assert.ok(reconciliation.reason instanceof AppError);
        assert.equal(reconciliation.reason.code, "INVALID_CREDENTIALS");
      }

      assert.equal(
        (await prisma.user.findUnique({ where: { id: user.id } }))?.accountStatus,
        accountStatus,
      );
    } finally {
      await cleanupTestUser(email);
    }
  });
}

for (const accountStatus of [AccountStatus.SUSPENDED, AccountStatus.DISABLED]) {
  test(`session creation rejects a ${accountStatus.toLowerCase()} account after moderation locks its row`, async () => {
    const email = `test-session-race-${accountStatus.toLowerCase()}@example.com`;
    await cleanupTestUser(email);

    const user = await register({
      email,
      password: "test-password-12345",
      displayName: "Session Race User",
    });
    const sessionToken = createOpaqueToken();
    let releaseModerator: (() => void) | undefined;
    const moderatorReady = new Promise<void>((resolve) => {
      releaseModerator = resolve;
    });

    try {
      const moderator = prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
        await transaction.user.update({
          where: { id: user.id },
          data: { accountStatus },
        });
        releaseModerator?.();
        await moderatorReady;
      });

      await moderatorReady;
      const sessionCreation = createSession(user.id, hashToken(sessionToken), {});
      releaseModerator?.();

      await assert.rejects(
        sessionCreation,
        (error: unknown) => error instanceof AppError && error.code === "INVALID_CREDENTIALS",
      );
      await moderator;
      assert.equal(await getSessionUser(hashToken(sessionToken)), null);
      assert.equal(
        (await prisma.session.findUnique({ where: { sessionHash: hashToken(sessionToken) } })),
        null,
      );
    } finally {
      await cleanupTestUser(email);
    }
  });
}

test("Session: revoked session cannot be used", async () => {
  const email = "test-session-revoke@example.com";
  await cleanupTestUser(email);

  const user = await register({
    email,
    password: "test-password-12345",
    displayName: "Test User",
  });

  // Approve account
  await prisma.user.update({
    where: { email },
    data: { accountStatus: AccountStatus.ACTIVE },
  });

  // Create session
  const token = createOpaqueToken();
  const tokenHash = hashToken(token);
  await createSession(user.id, tokenHash, {});

  // Verify session is valid
  let sessionUser = await getSessionUser(tokenHash);
  assert.notEqual(sessionUser, null);
  assert.equal(sessionUser?.email, email);

  // Revoke session
  await revokeSession(tokenHash);

  // Verify session is no longer valid
  sessionUser = await getSessionUser(tokenHash);
  assert.equal(sessionUser, null);

  await cleanupTestUser(email);
});

test("Session: expired session cannot be used", async () => {
  const email = "test-session-expire@example.com";
  await cleanupTestUser(email);

  const user = await register({
    email,
    password: "test-password-12345",
    displayName: "Test User",
  });

  // Approve account
  await prisma.user.update({
    where: { email },
    data: { accountStatus: AccountStatus.ACTIVE },
  });

  // Create session with past expiration
  const token = createOpaqueToken();
  const tokenHash = hashToken(token);
  await prisma.session.create({
    data: {
      userId: user.id,
      sessionHash: tokenHash,
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    },
  });

  // Verify session is not valid
  const sessionUser = await getSessionUser(tokenHash);
  assert.equal(sessionUser, null);

  await cleanupTestUser(email);
});

test("Session: disabled account cannot use existing sessions", async () => {
  const email = "test-session-disabled@example.com";
  await cleanupTestUser(email);

  const user = await register({
    email,
    password: "test-password-12345",
    displayName: "Test User",
  });

  // Approve account
  await prisma.user.update({
    where: { email },
    data: { accountStatus: AccountStatus.ACTIVE },
  });

  // Create session
  const token = createOpaqueToken();
  const tokenHash = hashToken(token);
  await createSession(user.id, tokenHash, {});

  // Verify session is valid
  let sessionUser = await getSessionUser(tokenHash);
  assert.notEqual(sessionUser, null);

  // Disable account
  await prisma.user.update({
    where: { email },
    data: { accountStatus: AccountStatus.DISABLED },
  });

  // Verify session is no longer valid
  sessionUser = await getSessionUser(tokenHash);
  assert.equal(sessionUser, null);

  await cleanupTestUser(email);
});

test("Password change: invalidates all sessions", async () => {
  const email = "test-password-change@example.com";
  await cleanupTestUser(email);

  const originalUser = await register({
    email,
    password: "original-password-123",
    displayName: "Test User",
  });

  // Approve account
  await prisma.user.update({
    where: { email },
    data: { accountStatus: AccountStatus.ACTIVE },
  });

  // Create multiple sessions
  const token1 = createOpaqueToken();
  const tokenHash1 = hashToken(token1);
  await createSession(originalUser.id, tokenHash1, {});

  const token2 = createOpaqueToken();
  const tokenHash2 = hashToken(token2);
  await createSession(originalUser.id, tokenHash2, {});

  // Verify both sessions are valid
  assert.notEqual(await getSessionUser(tokenHash1), null);
  assert.notEqual(await getSessionUser(tokenHash2), null);

  // Change password
  await changePassword(originalUser.id, "original-password-123", "new-password-1234567");

  // Verify both sessions are now invalid
  assert.equal(await getSessionUser(tokenHash1), null);
  assert.equal(await getSessionUser(tokenHash2), null);

  // Verify login works with new password
  const user = await authenticate({
    email,
    identifier: undefined,
    password: "new-password-1234567",
  });
  assert.equal(user.user.email, email);

  await cleanupTestUser(email);
});

test("Security: disabled or suspended accounts cannot receive or use token-based auth actions", async (t) => {
  await t.test("disabled accounts do not receive password-reset emails", async () => {
    const email = "test-password-reset-disabled@example.com";
    await cleanupTestUser(email);

    const user = await register({
      email,
      password: "test-password-12345",
      displayName: "Test User",
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: AccountStatus.DISABLED },
    });

    await requestPasswordReset(email);
    const tokens = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    assert.equal(tokens.length, 0);

    await cleanupTestUser(email);
  });

  await t.test("disabled accounts cannot redeem password-reset tokens", async () => {
    const email = "test-reset-disabled-account@example.com";
    await cleanupTestUser(email);

    const user = await register({
      email,
      password: "test-password-12345",
      displayName: "Test User",
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: AccountStatus.DISABLED },
    });

    const token = createOpaqueToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await assert.rejects(() => resetPassword({ token, password: "new-password-1234567" }), (error) => {
      if (error instanceof AppError) {
        assert.equal(error.code, "INVALID_RESET_TOKEN");
        return true;
      }
      return false;
    });

    await cleanupTestUser(email);
  });

  await t.test("disabled accounts cannot verify email tokens", async () => {
    const email = "test-email-verify-disabled@example.com";
    await cleanupTestUser(email);

    const user = await register({
      email,
      password: "test-password-12345",
      displayName: "Test User",
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: AccountStatus.DISABLED },
    });

    const token = createOpaqueToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await assert.rejects(() => verifyEmail(token), (error) => {
      if (error instanceof AppError) {
        assert.equal(error.code, "INVALID_VERIFICATION_TOKEN");
        return true;
      }
      return false;
    });

    await cleanupTestUser(email);
  });
});

test("DTO: toSafeUser does not expose sensitive fields", async () => {
  const email = "test-safe-user@example.com";
  await cleanupTestUser(email);

  const user = await register({
    email,
    password: "test-password-12345",
    displayName: "Test User",
  });

  // Verify returned user object doesn't include passwordHash
  assert.equal(user.passwordHash, undefined);
  assert.equal(user.lastLoginAt, undefined);
  assert.equal(user.updatedAt, undefined);

  // Verify it includes safe fields
  assert.equal(user.id, user.id);
  assert.equal(user.email, email);
  assert.equal(user.role, "STUDENT");
  assert.equal(user.accountStatus, "ACTIVE");

  await cleanupTestUser(email);
});
