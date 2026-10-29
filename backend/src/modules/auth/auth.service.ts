import { sendPasswordResetEmail, sendUniversityVerificationEmail, sendVerificationEmail } from "../../lib/email.js";
import {
  AccountStatus,
  EmailVerificationPurpose,
  Prisma,
  VerificationMethod,
  VerificationStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../app/errors.js";
import { env } from "../../config/env.js";
import {
  addHours,
  addMinutes,
  createOpaqueToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./auth.utils.js";
import { toSafeUser, type AuthenticatedUser } from "./auth.types.js";
import type {
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.schemas.js";
import {
  encryptRegistrationNumber,
  expectedMutStudentEmail,
  registrationNumberHash,
} from "../verification/verification.utils.js";

const GENERIC_AUTH_ERROR = new AppError(
  401,
  "INVALID_CREDENTIALS",
  "Unable to sign in with those credentials.",
);

export async function register(input: RegisterInput) {
  const passwordHash = await hashPassword(input.password);
  const rawToken = createOpaqueToken();
  const registrationNumber = input.registrationNumber?.trim();
  const isManualStudentVerification =
    input.verificationMethod === VerificationMethod.MANUAL_STUDENT &&
    Boolean(registrationNumber);
  const isUniversityEmailVerification =
    input.verificationMethod === VerificationMethod.UNIVERSITY_EMAIL &&
    Boolean(registrationNumber);
  const universityToken = isUniversityEmailVerification
    ? createOpaqueToken()
    : undefined;

  try {
    const user = await prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          email: input.email,
          passwordHash,
          accountStatus: AccountStatus.ACTIVE,
        },
      });

      let studentProfile: { id: string } | undefined;

      if (isManualStudentVerification && registrationNumber) {
        studentProfile = await transaction.studentProfile.create({
          data: {
            userId: created.id,
            displayName: input.displayName,
            verificationStatus: VerificationStatus.PENDING,
            registrationNumberHash: registrationNumberHash(registrationNumber),
            registrationNumberCiphertext: encryptRegistrationNumber(registrationNumber),
          },
        });

        await transaction.verification.create({
          data: {
            userId: created.id,
            studentProfileId: studentProfile.id,
            method: VerificationMethod.MANUAL_STUDENT,
            status: VerificationStatus.PENDING,
          },
        });
      } else if (isUniversityEmailVerification && registrationNumber) {
        studentProfile = await transaction.studentProfile.create({
          data: {
            userId: created.id,
            displayName: input.displayName,
            verificationStatus: VerificationStatus.PENDING,
            registrationNumberHash: registrationNumberHash(registrationNumber),
            registrationNumberCiphertext: encryptRegistrationNumber(registrationNumber),
          },
        });

        const verification = await transaction.verification.create({
          data: {
            userId: created.id,
            studentProfileId: studentProfile.id,
            method: VerificationMethod.UNIVERSITY_EMAIL,
            status: VerificationStatus.PENDING,
            universityEmail: expectedMutStudentEmail(registrationNumber),
          },
        });

        if (universityToken) {
          await transaction.emailVerificationToken.create({
            data: {
              userId: created.id,
              purpose: EmailVerificationPurpose.UNIVERSITY_EMAIL,
              verificationId: verification.id,
              tokenHash: hashToken(universityToken),
              expiresAt: addHours(env.EMAIL_VERIFICATION_TTL_HOURS),
            },
          });
        }
      } else {
        studentProfile = await transaction.studentProfile.create({
          data: {
            userId: created.id,
            displayName: input.displayName,
            verificationStatus: VerificationStatus.PENDING,
          },
        });
      }

      await transaction.emailVerificationToken.create({
        data: {
          userId: created.id,
          tokenHash: hashToken(rawToken),
          expiresAt: addHours(env.EMAIL_VERIFICATION_TTL_HOURS),
        },
      });

      return created;
    });

    if (isUniversityEmailVerification && registrationNumber && universityToken) {
      try {
        await sendUniversityVerificationEmail(expectedMutStudentEmail(registrationNumber), universityToken);
      } catch {
        console.error("University verification email delivery failed; registration completed.");
      }
    }

    // Email ownership verification is separate from student verification.
    // Accounts remain usable while student verification is pending.
    try {
      await sendVerificationEmail(input.email, rawToken);
    } catch {
      console.error("Account verification email delivery failed; registration completed.");
    }

    return toSafeUser(user);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const target = error.meta?.target;
      const targetFields = Array.isArray(target)
        ? target.map(String)
        : typeof target === "string"
          ? [target]
          : [];

      if (targetFields.some((field) => field.toLowerCase().includes("email"))) {
        throw new AppError(
          409,
          "EMAIL_ALREADY_EXISTS",
          "An account with this email already exists. Please log in or reset your password.",
        );
      }

      throw new AppError(
        409,
        "REGISTRATION_CONFLICT",
        "The submitted account or student verification information conflicts with an existing record.",
      );
    }

    throw error;
  }
}

export async function authenticate(
  input: LoginInput,
): Promise<{ user: AuthenticatedUser; userId: string }> {
  const email = input.email || input.identifier;

  if (!email) {
    throw GENERIC_AUTH_ERROR;
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  const passwordHash =
    user?.passwordHash ||
    (await hashPassword("campus-marketplace-invalid-login"));

  const passwordMatches = await verifyPassword(
    passwordHash,
    input.password,
  );

  if (!user || !passwordMatches) {
    throw GENERIC_AUTH_ERROR;
  }

  if (
    user.accountStatus === AccountStatus.SUSPENDED ||
    user.accountStatus === AccountStatus.DISABLED
  ) {
    throw GENERIC_AUTH_ERROR;
  }

  // PENDING_VERIFICATION is retained for accounts created by the legacy
  // email-gated workflow. Successful password authentication is enough to
  // reconcile that state under the current policy; suspended and disabled
  // accounts are rejected above and are never activated here.
  const authenticatedUser = await reconcileAccountForLogin(user.id);

  return {
    user: toSafeUser(authenticatedUser),
    userId: user.id,
  };
}

export async function reconcileAccountForLogin(
  userId: string,
): Promise<AuthenticatedUser> {
  const updated = await prisma.user.updateMany({
    where: {
      id: userId,
      accountStatus: {
        in: [AccountStatus.PENDING_VERIFICATION, AccountStatus.ACTIVE],
      },
    },
    data: {
      accountStatus: AccountStatus.ACTIVE,
      lastLoginAt: new Date(),
    },
  });

  if (updated.count !== 1) {
    throw GENERIC_AUTH_ERROR;
  }

  const authenticatedUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!authenticatedUser || authenticatedUser.accountStatus !== AccountStatus.ACTIVE) {
    throw GENERIC_AUTH_ERROR;
  }

  return toSafeUser(authenticatedUser);
}

export async function createSession(
  userId: string,
  tokenHash: string,
  metadata: {
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<void> {
  const metadataFields = {
    ...(metadata.ipAddress
      ? { ipAddress: metadata.ipAddress }
      : {}),
    ...(metadata.userAgent
      ? { userAgent: metadata.userAgent }
      : {}),
  };

  await prisma.$transaction(async (transaction) => {
    const users = await transaction.$queryRaw<Array<{ accountStatus: AccountStatus }>>`
      SELECT "accountStatus"
      FROM "users"
      WHERE "id" = ${userId}::uuid
      FOR UPDATE
    `;

    if (users.length !== 1 || users[0]?.accountStatus !== AccountStatus.ACTIVE) {
      throw GENERIC_AUTH_ERROR;
    }

    await transaction.session.create({
      data: {
        userId,
        sessionHash: tokenHash,
        expiresAt: addHours(env.SESSION_TTL_HOURS),
        ...metadataFields,
      },
    });
  });
}

export async function getSessionUser(
  tokenHash: string,
): Promise<AuthenticatedUser | null> {
  const session = await prisma.session.findUnique({
    where: { sessionHash: tokenHash },
    include: { user: true },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date()
  ) {
    return null;
  }

  if (session.user.accountStatus !== AccountStatus.ACTIVE) {
    return null;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });

  return toSafeUser(session.user);
}

export async function revokeSession(
  tokenHash: string,
): Promise<void> {
  await prisma.session.updateMany({
    where: {
      sessionHash: tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export async function verifyEmail(
  token: string,
): Promise<void> {
  const now = new Date();

  const record = await prisma.emailVerificationToken.findUnique({
    where: {
      tokenHash: hashToken(token),
    },
    include: { user: true },
  });

  if (
    !record ||
    record.purpose !== EmailVerificationPurpose.ACCOUNT_EMAIL ||
    !record.user ||
    record.user.accountStatus === AccountStatus.DISABLED ||
    record.user.accountStatus === AccountStatus.SUSPENDED ||
    record.consumedAt ||
    record.expiresAt <= now
  ) {
    throw new AppError(
      400,
      "INVALID_VERIFICATION_TOKEN",
      "The verification link is invalid or expired.",
    );
  }

  await prisma.$transaction(async (transaction) => {
    // Consume only an unexpired account-email token, exactly once.
    const consumed = await transaction.emailVerificationToken.updateMany({
      where: {
        id: record.id,
        purpose: EmailVerificationPurpose.ACCOUNT_EMAIL,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        consumedAt: now,
      },
    });

    if (consumed.count !== 1) {
      throw new AppError(
        400,
        "INVALID_VERIFICATION_TOKEN",
        "The verification link is invalid or expired.",
      );
    }

    // Do not activate an account that became disabled or suspended.
    const updatedUser = await transaction.user.updateMany({
      where: {
        id: record.userId,
        accountStatus: {
          notIn: [
            AccountStatus.DISABLED,
            AccountStatus.SUSPENDED,
          ],
        },
      },
      data: {
        emailVerifiedAt: now,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    if (updatedUser.count !== 1) {
      throw new AppError(
        400,
        "INVALID_VERIFICATION_TOKEN",
        "The verification link is invalid or expired.",
      );
    }
  });
}

export async function resendVerification(
  email: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (
    !user ||
    user.emailVerifiedAt ||
    user.accountStatus === AccountStatus.DISABLED ||
    user.accountStatus === AccountStatus.SUSPENDED
  ) {
    return;
  }

  const rawToken = createOpaqueToken();

  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: addHours(env.EMAIL_VERIFICATION_TTL_HOURS),
    },
  });

  // Send the new raw token by email.
  // Only the hash is stored in the database.
  try {
    await sendVerificationEmail(user.email, rawToken);
  } catch {
    // Keep the same public response for eligible and ineligible accounts.
    console.error("Account verification email delivery failed.");
  }
}

export async function requestPasswordReset(
  email: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || user.accountStatus === AccountStatus.DISABLED || user.accountStatus === AccountStatus.SUSPENDED) {
    return;
  }

  const rawToken = createOpaqueToken();

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: addMinutes(
        env.PASSWORD_RESET_TTL_MINUTES,
      ),
    },
  });

  try {
    await sendPasswordResetEmail(email, rawToken);
  } catch {
    // Do not reveal account existence through provider failures.
    console.error("Password reset email delivery failed.");
  }
}

export async function resetPassword(
  input: ResetPasswordInput,
): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: {
      tokenHash: hashToken(input.token),
    },
    include: { user: true },
  });

  if (
    !record ||
    !record.user ||
    (record.user.accountStatus === AccountStatus.DISABLED ||
      record.user.accountStatus === AccountStatus.SUSPENDED) ||
    record.consumedAt ||
    record.expiresAt <= new Date()
  ) {
    throw new AppError(
      400,
      "INVALID_RESET_TOKEN",
      "The password reset link is invalid or expired.",
    );
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: {
        consumedAt: new Date(),
      },
    }),

    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
      },
    }),

    prisma.session.updateMany({
      where: {
        userId: record.userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    }),
  ]);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (
    !user ||
    user.accountStatus !== AccountStatus.ACTIVE ||
    !(await verifyPassword(
      user.passwordHash,
      currentPassword,
    ))
  ) {
    throw GENERIC_AUTH_ERROR;
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
      },
    }),

    prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    }),
  ]);
}
