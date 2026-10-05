import { sendPasswordResetEmail, sendVerificationEmail } from "../../lib/email.js";
import {
  AccountStatus,
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

        await transaction.verification.create({
          data: {
            userId: created.id,
            studentProfileId: studentProfile.id,
            method: VerificationMethod.UNIVERSITY_EMAIL,
            status: VerificationStatus.PENDING,
          },
        });
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

    // Email ownership verification is separate from student verification.
    // Accounts remain usable while student verification is pending.
    await sendVerificationEmail(input.email, rawToken);

    return toSafeUser(user);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(
        409,
        "EMAIL_ALREADY_EXISTS",
        "An account with this email already exists. Please log in or reset your password.",
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

  if (user.accountStatus !== AccountStatus.ACTIVE) {
    throw GENERIC_AUTH_ERROR;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    user: toSafeUser(user),
    userId: user.id,
  };
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

  await prisma.session.create({
    data: {
      userId,
      sessionHash: tokenHash,
      expiresAt: addHours(env.SESSION_TTL_HOURS),
      ...metadataFields,
    },
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
  const record = await prisma.emailVerificationToken.findUnique({
    where: {
      tokenHash: hashToken(token),
    },
  });

  if (
    !record ||
    record.consumedAt ||
    record.expiresAt <= new Date()
  ) {
    throw new AppError(
      400,
      "INVALID_VERIFICATION_TOKEN",
      "The verification link is invalid or expired.",
    );
  }

  await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: {
        consumedAt: new Date(),
      },
    }),

    prisma.user.update({
      where: { id: record.userId },
      data: {
        emailVerifiedAt: new Date(),
        accountStatus: AccountStatus.ACTIVE,
      },
    }),

  ]);
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
  await sendVerificationEmail(user.email, rawToken);
}

export async function requestPasswordReset(
  email: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
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

    await sendPasswordResetEmail(email, rawToken);
}

export async function resetPassword(
  input: ResetPasswordInput,
): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: {
      tokenHash: hashToken(input.token),
    },
  });

  if (
    !record ||
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
