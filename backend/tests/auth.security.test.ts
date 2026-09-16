import assert from "node:assert/strict";
import test from "node:test";
import { AccountStatus, VerificationMethod } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { authenticate, register, createSession, getSessionUser, revokeSession, changePassword } from "../src/modules/auth/auth.service.js";
import { hashToken, createOpaqueToken } from "../src/modules/auth/auth.utils.js";
import { AppError } from "../src/app/errors.js";


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
      verificationMethod: VerificationMethod.MANUAL_STUDENT,
      registrationNumber: "ABC123DEF456",
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

  await t.test("pending verification account returns generic error", async () => {
    const email = "test-auth-pending@example.com";
    await cleanupTestUser(email);

    await register({
      email,
      password: "test-password-12345",
      displayName: "Test User",
      verificationMethod: VerificationMethod.MANUAL_STUDENT,
      registrationNumber: "ABC123DEF457",
    });

    // Do NOT approve - leave PENDING_VERIFICATION
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

  await t.test("disabled account returns generic error", async () => {
    const email = "test-auth-disabled@example.com";
    await cleanupTestUser(email);

    await register({
      email,
      password: "test-password-12345",
      displayName: "Test User",
      verificationMethod: VerificationMethod.MANUAL_STUDENT,
      registrationNumber: "ABC123DEF458",
    });

    // Set to DISABLED
    await prisma.user.update({
      where: { email },
      data: { accountStatus: AccountStatus.DISABLED },
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
});

test("Session: revoked session cannot be used", async () => {
  const email = "test-session-revoke@example.com";
  await cleanupTestUser(email);

  const user = await register({
    email,
    password: "test-password-12345",
    displayName: "Test User",
    verificationMethod: VerificationMethod.MANUAL_STUDENT,
    registrationNumber: "ABC123DEF459",
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
    verificationMethod: VerificationMethod.MANUAL_STUDENT,
    registrationNumber: "ABC123DEF460",
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
    verificationMethod: VerificationMethod.MANUAL_STUDENT,
    registrationNumber: "ABC123DEF461",
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
    verificationMethod: VerificationMethod.MANUAL_STUDENT,
    registrationNumber: "ABC123DEF462",
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

test("DTO: toSafeUser does not expose sensitive fields", async () => {
  const email = "test-safe-user@example.com";
  await cleanupTestUser(email);

  const user = await register({
    email,
    password: "test-password-12345",
    displayName: "Test User",
    verificationMethod: VerificationMethod.MANUAL_STUDENT,
    registrationNumber: "ABC123DEF463",
  });

  // Verify returned user object doesn't include passwordHash
  assert.equal(user.passwordHash, undefined);
  assert.equal(user.lastLoginAt, undefined);
  assert.equal(user.updatedAt, undefined);

  // Verify it includes safe fields
  assert.equal(user.id, user.id);
  assert.equal(user.email, email);
  assert.equal(user.role, "STUDENT");
  assert.equal(user.accountStatus, "PENDING_VERIFICATION");

  await cleanupTestUser(email);
});
