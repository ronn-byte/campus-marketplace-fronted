import { prisma } from "../../lib/prisma.js";
import { AccountStatus } from "@prisma/client";
import { AppError } from "../../app/errors.js";

export type ProfilePayload = {
  id: string;
  userId: string;
  email: string;
  nickname: string | null;
  phoneNumber: string | null;
  whatsappNumber: string | null;
  yearOfStudy: number | null;
  course: string | null;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function isSellerProfileComplete(
  profile: Pick<ProfilePayload, "nickname" | "course"> | null,
): boolean {
  return Boolean(profile?.nickname?.trim() && profile.course?.trim());
}

export async function getCurrentProfile(userId: string): Promise<ProfilePayload> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  const profile = await prisma.profile.findUnique({
    where: { userId },
  });

  return {
    id: profile?.id ?? user.id,
    userId: user.id,
    email: user.email,
    nickname: profile?.nickname ?? null,
    phoneNumber: profile?.phoneNumber ?? null,
    whatsappNumber: profile?.whatsappNumber ?? null,
    yearOfStudy: profile?.yearOfStudy ?? null,
    course: profile?.course ?? null,
    bio: profile?.bio ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    createdAt: profile?.createdAt ?? new Date(),
    updatedAt: profile?.updatedAt ?? new Date(),
  };
}

export async function updateCurrentProfile(userId: string, input: Record<string, unknown>) {
  await prisma.profile.upsert({
    where: { userId },
    update: input,
    create: {
      userId,
      ...input,
    },
  });

  return getCurrentProfile(userId);
}

export async function getPublicSellerProfile(userId: string, includeContactDetails = false) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: { not: null },
    },
    select: {
      profile: { select: { nickname: true, phoneNumber: true, whatsappNumber: true, bio: true, avatarUrl: true } },
      studentProfile: { select: { displayName: true } },
    },
  });
  if (!user) throw new AppError(404, "SELLER_NOT_FOUND", "This seller profile is unavailable.");
  return {
    name: user.profile?.nickname || user.studentProfile?.displayName || "MUT Market seller",
    avatarUrl: user.profile?.avatarUrl ?? null,
    description: user.profile?.bio ?? null,
    phoneNumber: includeContactDetails ? (user.profile?.phoneNumber ?? null) : null,
    whatsappNumber: includeContactDetails ? (user.profile?.whatsappNumber ?? null) : null,
  };
}
