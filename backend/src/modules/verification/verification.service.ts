import { AccountStatus, Prisma, Role, VerificationMethod, VerificationStatus } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { prisma } from "../../lib/prisma.js";
import { createOpaqueToken, hashToken } from "../auth/auth.utils.js";
import { addHours } from "../auth/auth.utils.js";
import { env } from "../../config/env.js";
import { sendVerificationEmail } from "../../lib/email.js";
import { decryptRegistrationNumber, encryptRegistrationNumber, expectedMutStudentEmail, isExpectedMutStudentEmail, normalizeRegistrationNumber, registrationNumberHash } from "./verification.utils.js";

type ReviewStatus = Extract<VerificationStatus, "APPROVED" | "REJECTED">;

export type VerificationSubmissionInput = {
  method: VerificationMethod;
  registrationNumber: string;
  displayName?: string | undefined;
  email?: string | undefined;
};

export async function getUserVerificationState(userId: string) {
  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: {
      verificationStatus: true,
      displayName: true,
      registrationNumberCiphertext: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          accountStatus: true,
          role: true,
        },
      },
    },
  });

  const mostRecentVerification = await prisma.verification.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      method: true,
      status: true,
      reason: true,
      createdAt: true,
      reviewedAt: true,
    },
  });

  const status = studentProfile?.verificationStatus ?? VerificationStatus.PENDING;
  const maySell = Boolean(
    studentProfile &&
    studentProfile.user.accountStatus === AccountStatus.ACTIVE &&
    status === VerificationStatus.APPROVED,
  );

  return {
    userId,
    verified: status === VerificationStatus.APPROVED,
    status,
    method: mostRecentVerification?.method ?? null,
    maySell,
    displayName: studentProfile?.displayName ?? null,
    createdAt: studentProfile?.createdAt ?? null,
    updatedAt: studentProfile?.updatedAt ?? null,
  };
}

export async function assertSellerAuthorized(userId: string): Promise<void> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: {
      verificationStatus: true,
      user: {
        select: { accountStatus: true },
      },
    },
  });

  if (!profile || profile.user.accountStatus !== AccountStatus.ACTIVE) {
    throw new AppError(403, "SELLER_VERIFICATION_REQUIRED", "Student verification is required before you can sell.");
  }

  if (profile.verificationStatus !== VerificationStatus.APPROVED) {
    throw new AppError(403, "SELLER_VERIFICATION_REQUIRED", "Student verification is required before you can sell.");
  }
}

export async function listPendingManualVerifications() {
  const records = await prisma.verification.findMany({
    where: { method: VerificationMethod.MANUAL_STUDENT, status: VerificationStatus.PENDING },
    include: { user: { select: { id: true, email: true, accountStatus: true, createdAt: true } }, studentProfile: true },
    orderBy: { createdAt: "asc" },
  });
  return records.map((record) => ({
    id: record.id,
    user: record.user,
    displayName: record.studentProfile?.displayName,
    registrationNumber: record.studentProfile?.registrationNumberCiphertext
      ? decryptRegistrationNumber(record.studentProfile.registrationNumberCiphertext)
      : null,
    status: record.status,
    method: record.method,
    createdAt: record.createdAt,
  }));
}

export async function reviewManualVerification(verificationId: string, reviewerId: string, status: ReviewStatus, reason: string) {
  const record = await prisma.verification.findUnique({ where: { id: verificationId } });
  if (!record || record.method !== VerificationMethod.MANUAL_STUDENT) throw new AppError(404, "VERIFICATION_NOT_FOUND", "Verification request not found.");
  if (record.status !== VerificationStatus.PENDING) throw new AppError(409, "VERIFICATION_ALREADY_REVIEWED", "Verification request has already been reviewed.");

  const reviewer = await prisma.user.findUnique({
    where: { id: reviewerId },
    select: { role: true },
  });

  if (!reviewer || (reviewer.role !== Role.MODERATOR && reviewer.role !== Role.ADMINISTRATOR)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to review verification requests.");
  }

  if (record.userId === reviewerId) {
    throw new AppError(403, "FORBIDDEN", "Users cannot review their own verification.");
  }

  const reviewedAt = new Date();
  await prisma.$transaction([
    prisma.verification.update({ where: { id: verificationId }, data: { status, reason, reviewedById: reviewerId, reviewedAt } }),
    prisma.studentProfile.update({ where: { userId: record.userId }, data: { verificationStatus: status } }),
  ]);

  return { id: verificationId, status, reviewedAt };
}

export async function submitVerification(userId: string, input: VerificationSubmissionInput) {
  const registrationNumber = input.registrationNumber.trim();
  if (!registrationNumber || registrationNumber.length < 4) {
    throw new AppError(422, "VALIDATION_ERROR", "A valid registration number is required.");
  }

  const studentProfile = await prisma.studentProfile.findUnique({ where: { userId } });
  const normalizedRegistrationNumber = normalizeRegistrationNumber(registrationNumber);

  if (input.method === VerificationMethod.UNIVERSITY_EMAIL) {
    const expectedEmail = expectedMutStudentEmail(registrationNumber);
    const suppliedEmail = (input.email ?? expectedEmail).trim().toLowerCase();

    if (!isExpectedMutStudentEmail(registrationNumber, suppliedEmail)) {
      throw new AppError(422, "INVALID_STUDENT_EMAIL", "The registration number does not match the expected MUT student email.");
    }

    const record = await prisma.verification.create({
      data: {
        userId,
        studentProfileId: studentProfile?.id ?? null,
        method: VerificationMethod.UNIVERSITY_EMAIL,
        status: VerificationStatus.PENDING,
        reason: "Awaiting university email verification.",
      },
    });

    const rawToken = createOpaqueToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
      },
    });

    await sendVerificationEmail(expectedEmail, rawToken);

    return {
      id: record.id,
      method: VerificationMethod.UNIVERSITY_EMAIL,
      status: VerificationStatus.PENDING,
      maySell: false,
    };
  }

  if (input.method === VerificationMethod.MANUAL_STUDENT) {
    const profile = studentProfile ?? await prisma.studentProfile.create({
      data: {
        userId,
        displayName: input.displayName ?? "Student",
        verificationStatus: VerificationStatus.PENDING,
        registrationNumberHash: registrationNumberHash(registrationNumber),
        registrationNumberCiphertext: encryptRegistrationNumber(registrationNumber),
      },
    });

    const record = await prisma.verification.create({
      data: {
        userId,
        studentProfileId: profile.id,
        method: VerificationMethod.MANUAL_STUDENT,
        status: VerificationStatus.PENDING,
        reason: "Awaiting manual verification.",
      },
    });

    await prisma.studentProfile.upsert({
      where: { userId },
      update: {
        displayName: input.displayName ?? profile.displayName,
        verificationStatus: VerificationStatus.PENDING,
        registrationNumberHash: registrationNumberHash(registrationNumber),
        registrationNumberCiphertext: encryptRegistrationNumber(registrationNumber),
      },
      create: {
        userId,
        displayName: input.displayName ?? "Student",
        verificationStatus: VerificationStatus.PENDING,
        registrationNumberHash: registrationNumberHash(registrationNumber),
        registrationNumberCiphertext: encryptRegistrationNumber(registrationNumber),
      },
    });

    return {
      id: record.id,
      method: VerificationMethod.MANUAL_STUDENT,
      status: VerificationStatus.PENDING,
      maySell: false,
    };
  }

  throw new AppError(422, "VALIDATION_ERROR", "Unsupported verification method.");
}

export async function verifyUniversityEmailToken(token: string): Promise<void> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!record || record.consumedAt || record.expiresAt <= new Date()) {
    throw new AppError(400, "INVALID_VERIFICATION_TOKEN", "The university email verification link is invalid or expired.");
  }

  await prisma.$transaction([
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.verification.updateMany({
      where: {
        userId: record.userId,
        method: VerificationMethod.UNIVERSITY_EMAIL,
        status: VerificationStatus.PENDING,
      },
      data: {
        status: VerificationStatus.APPROVED,
        reviewedAt: new Date(),
        reason: "University email verified.",
      },
    }),
    prisma.studentProfile.update({
      where: { userId: record.userId },
      data: { verificationStatus: VerificationStatus.APPROVED },
    }),
  ]);
}
