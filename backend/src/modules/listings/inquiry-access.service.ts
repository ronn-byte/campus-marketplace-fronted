import { InquiryMessageSender } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { prisma } from "../../lib/prisma.js";
import { assertBuyerAuthorized, assertSellerAuthorized } from "../verification/verification.service.js";

export async function getInquiryAccess(
  listingId: string | undefined,
  inquiryId: string,
  userId: string,
) {
  const inquiry = await prisma.listingInquiry.findFirst({
    where: { id: inquiryId, ...(listingId ? { listingId } : {}) },
    select: {
      id: true,
      buyerId: true,
      status: true,
      listing: { select: { sellerId: true } },
    },
  });

  if (!inquiry) {
    throw new AppError(404, "INQUIRY_NOT_FOUND", "Inquiry not found.");
  }

  if (inquiry.buyerId === userId) {
    await assertBuyerAuthorized(userId);
    return { inquiry, viewerRole: InquiryMessageSender.BUYER };
  }

  if (inquiry.listing.sellerId === userId) {
    await assertSellerAuthorized(userId);
    return { inquiry, viewerRole: InquiryMessageSender.SELLER };
  }

  throw new AppError(404, "INQUIRY_NOT_FOUND", "Inquiry not found.");
}
