import { AccountStatus, InquiryMessageSender } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { prisma } from "../../lib/prisma.js";
import { getInquiryAccess } from "../listings/inquiry-access.service.js";
import { getProfileContactAccess, getVisibleProfileContactFields } from "./profile-contact-access.js";

export type ProfilePayload = {
  id: string;
  userId: string;
  email: string;
  nickname: string | null;
  phoneNumber: string | null;
  whatsappNumber: string | null;
  sellerPublicPhoneNumber: string | null;
  sellerPublicWhatsappNumber: string | null;
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
    sellerPublicPhoneNumber: profile?.sellerPublicPhoneNumber ?? null,
    sellerPublicWhatsappNumber: profile?.sellerPublicWhatsappNumber ?? null,
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

export async function getPublicSellerProfile(
  userId: string,
  includeContactDetails = false,
  viewerId?: string,
  inquiryId?: string,
) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: { not: null },
    },
    select: {
      profile: { select: {
        nickname: true,
        course: true,
        phoneNumber: true,
        whatsappNumber: true,
        sellerPublicPhoneNumber: true,
        sellerPublicWhatsappNumber: true,
        bio: true,
        avatarUrl: true,
      } },
      studentProfile: { select: { displayName: true } },
      // Persisted listing ownership, including retained sold/removed listings,
      // is the available evidence that this user has acted as a seller.
      listings: { take: 1, select: { id: true } },
    },
  });
  if (!user) throw new AppError(404, "SELLER_NOT_FOUND", "This seller profile is unavailable.");

  let inquiryViewerRole: InquiryMessageSender | undefined;
  let inquiryBuyerMatchesProfile = false;
  if (inquiryId && includeContactDetails && viewerId) {
    try {
      const { inquiry, viewerRole } = await getInquiryAccess(undefined, inquiryId, viewerId);
      inquiryViewerRole = viewerRole;
      inquiryBuyerMatchesProfile = inquiry.buyerId === userId;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
  const contactAccess = getProfileContactAccess({
    isAuthenticated: includeContactDetails,
    targetOwnsListing: user.listings.length > 0,
    hasInquiryId: Boolean(inquiryId),
    inquiryViewerRole,
    inquiryBuyerMatchesProfile,
  });
  const contactFields = getVisibleProfileContactFields(contactAccess, {
    sellerPublicPhoneNumber: user.profile?.sellerPublicPhoneNumber ?? null,
    sellerPublicWhatsappNumber: user.profile?.sellerPublicWhatsappNumber ?? null,
    buyerPrivatePhoneNumber: user.profile?.phoneNumber ?? null,
    buyerPrivateWhatsappNumber: user.profile?.whatsappNumber ?? null,
  });

  return {
    name: user.profile?.nickname || user.studentProfile?.displayName || "MUT Market seller",
    avatarUrl: user.profile?.avatarUrl ?? null,
    description: user.profile?.bio ?? null,
    ...contactFields,
  };
}
