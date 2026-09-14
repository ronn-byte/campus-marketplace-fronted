import { AccountStatus, VerificationMethod, VerificationStatus } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { prisma } from "../../lib/prisma.js";
import { decryptRegistrationNumber } from "./verification.utils.js";

type ReviewStatus = Extract<VerificationStatus, "APPROVED" | "REJECTED">;

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

  const reviewedAt = new Date();
  const accountStatus = status === VerificationStatus.APPROVED ? AccountStatus.ACTIVE : AccountStatus.PENDING_VERIFICATION;
  await prisma.$transaction([
    prisma.verification.update({ where: { id: verificationId }, data: { status, reason, reviewedById: reviewerId, reviewedAt } }),
    prisma.studentProfile.update({ where: { userId: record.userId }, data: { verificationStatus: status } }),
    prisma.user.update({ where: { id: record.userId }, data: { accountStatus } }),
  ]);

  return { id: verificationId, status, reviewedAt };
}
