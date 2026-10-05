import { prisma } from "../../lib/prisma.js";

export type ProfilePayload = {
  id: string;
  userId: string;
  email: string;
  nickname: string | null;
  phoneNumber: string | null;
  yearOfStudy: number | null;
  course: string | null;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

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
    yearOfStudy: profile?.yearOfStudy ?? null,
    course: profile?.course ?? null,
    bio: profile?.bio ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    createdAt: profile?.createdAt ?? new Date(),
    updatedAt: profile?.updatedAt ?? new Date(),
  };
}

export async function updateCurrentProfile(userId: string, input: Record<string, unknown>) {
  const profile = await prisma.profile.upsert({
    where: { userId },
    update: input,
    create: {
      userId,
      ...input,
    },
  });

  return getCurrentProfile(userId);
}
