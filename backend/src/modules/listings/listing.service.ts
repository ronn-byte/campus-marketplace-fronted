import { ListingCondition, ListingStatus } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { prisma } from "../../lib/prisma.js";
import { assertSellerAuthorized } from "../verification/verification.service.js";

type CreateListingInput = {
  categoryId: string;
  title: string;
  description: string;
  price: number;
  condition: ListingCondition;
  location: string;
};

export async function createListing(
  sellerId: string,
  input: CreateListingInput,
) {
  await assertSellerAuthorized(sellerId);

  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, isActive: true },
  });

  if (!category) {
    throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found.");
  }

  if (!category.isActive) {
    throw new AppError(
      409,
      "CATEGORY_INACTIVE",
      "This category is not currently available.",
    );
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

type PublishListingInput = {
  listingId: string;
  sellerId: string;
};

export async function publishListing(input: PublishListingInput) {
  await assertSellerAuthorized(input.sellerId);

  const listing = await prisma.listing.findUnique({
    where: {
      id: input.listingId,
    },
    select: {
      id: true,
      sellerId: true,
      status: true,
      category: {
        select: {
          id: true,
          isActive: true,
        },
      },
    },
  });

  if (!listing) {
    throw new AppError(
      404,
      "LISTING_NOT_FOUND",
      "Listing not found.",
    );
  }

  if (listing.sellerId !== input.sellerId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to publish this listing.",
    );
  }

  if (listing.status !== ListingStatus.DRAFT) {
    throw new AppError(
      409,
      "INVALID_LISTING_STATUS",
      "Only draft listings can be published.",
    );
  }

  if (!listing.category.isActive) {
    throw new AppError(
      409,
      "CATEGORY_INACTIVE",
      "This category is not currently available.",
    );
  }

  const publishedListing = await prisma.listing.update({
    where: {
      id: listing.id,
    },
    data: {
      status: ListingStatus.PUBLISHED,
      publishedAt: new Date(),
    },
    select: {
      id: true,
      title: true,
      description: true,
      price: true,
      condition: true,
      location: true,
      status: true,
      createdAt: true,
      publishedAt: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  return publishedListing;
}

type ListPublishedListingsInput = {
  page: number;
  pageSize: number;
};

export async function getPublishedListings(
  input: ListPublishedListingsInput,
) {
  const skip = (input.page - 1) * input.pageSize;

  const [listings, total] = await prisma.$transaction([
    prisma.listing.findMany({
      where: {
        status: ListingStatus.PUBLISHED,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: input.pageSize,
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        condition: true,
        location: true,
        status: true,
        createdAt: true,
        publishedAt: true,
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        images: {
          where: {
            processingStatus: "READY",
          },
          orderBy: {
            sortOrder: "asc",
          },
          select: {
            id: true,
            objectKey: true,
            sortOrder: true,
          },
        },
      },
    }),

    prisma.listing.count({
      where: {
        status: ListingStatus.PUBLISHED,
      },
    }),
  ]);

  return {
    listings,
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function getPublicListing(listingId: string) {
  const listing = await prisma.listing.findFirst({
    where: {
      id: listingId,
      status: ListingStatus.PUBLISHED,
    },
    select: {
      id: true,
      title: true,
      description: true,
      price: true,
      condition: true,
      location: true,
      status: true,
      createdAt: true,
      publishedAt: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      images: {
        where: {
          processingStatus: "READY",
        },
        orderBy: {
          sortOrder: "asc",
        },
        select: {
          id: true,
          objectKey: true,
          sortOrder: true,
        },
      },
      seller: {
        select: {
          studentProfile: {
            select: {
              displayName: true,
              verificationStatus: true,
            },
          },
        },
      },
    },
  });

  if (!listing) {
    throw new AppError(
      404,
      "LISTING_NOT_FOUND",
      "Listing not found or is no longer available.",
    );
  }

  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    price: listing.price,
    condition: listing.condition,
    location: listing.location,
    status: listing.status,
    createdAt: listing.createdAt,
    publishedAt: listing.publishedAt,
    category: listing.category,
    images: listing.images,
    seller: {
      name: listing.seller.studentProfile?.displayName ?? "MUT student",
      verified:
        listing.seller.studentProfile?.verificationStatus === "APPROVED",
    },
  };
}

type UpdateListingInput = {
  [Key in keyof CreateListingInput]?: CreateListingInput[Key] | undefined;
};

export async function updateListing(
  listingId: string,
  sellerId: string,
  input: UpdateListingInput,
) {
  await assertSellerAuthorized(sellerId);

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      sellerId: true,
      status: true,
    },
  });

  if (!existing) {
    throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found.");
  }

  if (existing.sellerId !== sellerId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to update this listing.",
    );
  }

  if (
    existing.status !== ListingStatus.DRAFT &&
    existing.status !== ListingStatus.PUBLISHED
  ) {
    throw new AppError(
      409,
      "INVALID_LISTING_STATUS",
      "Only draft or published listings can be updated.",
    );
  }

  if (input.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true, isActive: true },
    });

    if (!category) {
      throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found.");
    }

    if (!category.isActive) {
      throw new AppError(
        409,
        "CATEGORY_INACTIVE",
        "This category is not currently available.",
      );
    }
  }

  return prisma.listing.update({
    where: { id: existing.id },
    data: {
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.price === undefined ? {} : { price: input.price }),
      ...(input.condition === undefined ? {} : { condition: input.condition }),
      ...(input.location === undefined ? {} : { location: input.location }),
    },
    select: {
      id: true,
      title: true,
      description: true,
      price: true,
      condition: true,
      location: true,
      status: true,
      createdAt: true,
      publishedAt: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      images: {
        where: { processingStatus: "READY" },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          objectKey: true,
          sortOrder: true,
        },
      },
    },
  });
}

export async function removeListing(listingId: string, sellerId: string) {
  await assertSellerAuthorized(sellerId);

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      sellerId: true,
      status: true,
    },
  });

  if (!existing) {
    throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found.");
  }

  if (existing.sellerId !== sellerId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to remove this listing.",
    );
  }

  if (existing.status === ListingStatus.REMOVED) {
    throw new AppError(
      409,
      "INVALID_LISTING_STATUS",
      "This listing has already been removed.",
    );
  }

  return prisma.listing.update({
    where: { id: existing.id },
    data: { status: ListingStatus.REMOVED },
    select: {
      id: true,
      status: true,
      updatedAt: true,
    },
  });
}