import { ListingCondition, ListingStatus } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { prisma } from "../../lib/prisma.js";

type CreateListingInput = {
  categoryId: string;
  title: string;
  description: string;
  price: number;
  condition: ListingCondition;
  location: string;
};

export async function createListing(sellerId: string, input: CreateListingInput) {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, isActive: true },
  });

  if (!category) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found.");
  }

  if (!category.isActive) {
    throw new AppError(409, "CATEGORY_INACTIVE", "This category is not currently available.");
  }

  const listing = await prisma.listing.create({
    data: {
      sellerId,
      categoryId: input.categoryId,
      title: input.title,
      description: input.description,
      price: input.price,
      condition: input.condition,
      location: input.location,
      status: ListingStatus.DRAFT,
    },
    include: {
      category: true,
      images: true,
    },
  });

  return listing;
}
