import { InquiryMessageSender } from "@prisma/client";

type ProfileContactAccessInput = {
  isAuthenticated: boolean;
  targetOwnsListing: boolean;
  hasInquiryId: boolean;
  inquiryViewerRole?: InquiryMessageSender | undefined;
  inquiryBuyerMatchesProfile: boolean;
};

export type ProfileContactAccess = "SELLER_PUBLIC" | "BUYER_PRIVATE" | null;

export type VisibleProfileContactFields = {
  sellerPublicPhoneNumber: string | null;
  sellerPublicWhatsappNumber: string | null;
  buyerPrivatePhoneNumber: string | null;
  buyerPrivateWhatsappNumber: string | null;
};

export function getProfileContactAccess(input: ProfileContactAccessInput): ProfileContactAccess {
  if (!input.isAuthenticated) return null;
  if (input.hasInquiryId) {
    return input.inquiryViewerRole === InquiryMessageSender.SELLER && input.inquiryBuyerMatchesProfile
      ? "BUYER_PRIVATE"
      : null;
  }
  return input.targetOwnsListing ? "SELLER_PUBLIC" : null;
}

export function getVisibleProfileContactFields(
  access: ProfileContactAccess,
  values: VisibleProfileContactFields,
): VisibleProfileContactFields {
  return {
    sellerPublicPhoneNumber: access === "SELLER_PUBLIC" ? values.sellerPublicPhoneNumber : null,
    sellerPublicWhatsappNumber: access === "SELLER_PUBLIC" ? values.sellerPublicWhatsappNumber : null,
    buyerPrivatePhoneNumber: access === "BUYER_PRIVATE" ? values.buyerPrivatePhoneNumber : null,
    buyerPrivateWhatsappNumber: access === "BUYER_PRIVATE" ? values.buyerPrivateWhatsappNumber : null,
  };
}
