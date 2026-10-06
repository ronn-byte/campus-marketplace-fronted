import {
  ListingCondition,
  ListingInquiryStatus,
  ListingStatus,
} from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { prisma } from "../../lib/prisma.js";
import {
  ALLOWED_LISTING_IMAGE_TYPES,
  MAX_LISTING_IMAGE_BYTES,
  MAX_LISTING_IMAGES_PER_LISTING,
  createListingObjectKey,
  deleteListingImageFiles,
  getListingImageUrl,
  writeListingImageFile,
} from "../../lib/storage.js";
import { assertSellerAuthorized } from "../verification/verification.service.js";

type ListingImageUpload = {
  buffer: Buffer;
  mimetype?: string;
};

type CreateListingInput = {
  categoryId: string;
  title: string;
  description: string;
  price: number;
  condition: ListingCondition;
  location: string;
};

function withImageUrls<T extends { objectKey: string }>(images: T[]) {
  return images.map((image) => ({
    ...image,
    url: getListingImageUrl(image.objectKey),
  }));
}

export async function getListingCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
}

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

  return {
    ...listing,
    images: withImageUrls(listing.images),
  };
}

export async function addListingImages(
  listingId: string,
  sellerId: string,
  files: ListingImageUpload[],
) {
  await assertSellerAuthorized(sellerId);

  if (files.length === 0) {
    throw new AppError(422, "VALIDATION_ERROR", "Please upload at least one image.");
  }

  if (files.length > MAX_LISTING_IMAGES_PER_LISTING) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      `A listing may contain up to ${MAX_LISTING_IMAGES_PER_LISTING} images.`,
    );
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, sellerId: true, status: true },
  });

  if (!listing) {
    throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found.");
  }

  if (listing.sellerId !== sellerId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to upload images for this listing.",
    );
  }

  if (
    listing.status !== ListingStatus.DRAFT &&
    listing.status !== ListingStatus.PUBLISHED
  ) {
    throw new AppError(
      409,
      "INVALID_LISTING_STATUS",
      "Only draft or published listings can receive images.",
    );
  }

  const existingCount = await prisma.listingImage.count({
    where: { listingId: listing.id },
  });

  if (existingCount + files.length > MAX_LISTING_IMAGES_PER_LISTING) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      `A listing may contain up to ${MAX_LISTING_IMAGES_PER_LISTING} images.`,
    );
  }

  const uploadedObjectKeys: string[] = [];
  const records: {
    listingId: string;
    objectKey: string;
    sortOrder: number;
    processingStatus: "READY";
  }[] = [];

  try {
    for (const [index, file] of files.entries()) {
      const mimeType = file.mimetype?.toLowerCase();
      if (!mimeType || !ALLOWED_LISTING_IMAGE_TYPES.has(mimeType)) {
        throw new AppError(
          422,
          "INVALID_IMAGE_TYPE",
          "Only JPEG, PNG, and WebP images are allowed.",
        );
      }

      const buffer = file.buffer;
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_LISTING_IMAGE_BYTES) {
        throw new AppError(
          422,
          "INVALID_IMAGE_SIZE",
          "Each image must be smaller than 5 MB.",
        );
      }

      const objectKey = createListingObjectKey(listingId, mimeType);
      await writeListingImageFile(objectKey, buffer);
      uploadedObjectKeys.push(objectKey);
      records.push({
        listingId: listing.id,
        objectKey,
        sortOrder: existingCount + index,
        processingStatus: "READY",
      });
    }

    await prisma.listingImage.createMany({
      data: records,
    });

    const images = await prisma.listingImage.findMany({
      where: { listingId: listing.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, objectKey: true, sortOrder: true, processingStatus: true },
    });

    return withImageUrls(images);
  } catch (error) {
    if (uploadedObjectKeys.length > 0) {
      await deleteListingImageFiles(uploadedObjectKeys);
    }

    throw error;
  }
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

async function transitionListing(
  listingId: string,
  sellerId: string,
  currentStatuses: ListingStatus[],
  nextStatus: ListingStatus,
) {
  await assertSellerAuthorized(sellerId);

  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true },
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

    if (!currentStatuses.includes(existing.status)) {
      throw new AppError(
        409,
        "INVALID_LISTING_STATUS",
        `This listing cannot transition from ${existing.status} to ${nextStatus}.`,
      );
    }

    const result = await transaction.listing.updateMany({
      where: {
        id: listingId,
        sellerId,
        status: { in: currentStatuses },
      },
      data: {
        status: nextStatus,
        ...(nextStatus === ListingStatus.SOLD ? { soldAt: new Date() } : {}),
      },
    });

    if (result.count !== 1) {
      throw new AppError(
        409,
        "INVALID_LISTING_STATUS",
        "The listing status has changed. Please try again.",
      );
    }

    return transaction.listing.findUniqueOrThrow({
      where: { id: listingId },
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
  });
}

export async function reserveListing(listingId: string, sellerId: string) {
  return transitionListing(
    listingId,
    sellerId,
    [ListingStatus.PUBLISHED],
    ListingStatus.RESERVED,
  );
}

export async function markListingSold(listingId: string, sellerId: string) {
  return transitionListing(
    listingId,
    sellerId,
    [ListingStatus.PUBLISHED, ListingStatus.RESERVED],
    ListingStatus.SOLD,
  );
}

export async function releaseListingReservation(
  listingId: string,
  sellerId: string,
) {
  return transitionListing(
    listingId,
    sellerId,
    [ListingStatus.RESERVED],
    ListingStatus.PUBLISHED,
  );
}
type ListPublishedListingsInput = {
  page: number;
  pageSize: number;
};

export async function getPublishedListings(
  input: ListPublishedListingsInput,
) {
  const skip = (input.page - 1) * input.pageSize;

  try {
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
      listings: listings.map((listing) => ({
        ...listing,
        images: withImageUrls(listing.images),
      })),
      meta: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: Math.ceil(total / input.pageSize),
      },
    };
  } catch (error) {
    console.error("GET PUBLISHED LISTINGS ERROR:", error);
    throw error;
  }
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
    images: withImageUrls(listing.images),
    seller: {
      name: listing.seller.studentProfile?.displayName ?? "MUT student",
      verified:
        listing.seller.studentProfile?.verificationStatus === "APPROVED",
    },
  };
}

export async function getSellerListings(
  sellerId: string,
  input: ListPublishedListingsInput,
) {
  const skip = (input.page - 1) * input.pageSize;

  const [listings, total] = await prisma.$transaction([
    prisma.listing.findMany({
      where: { sellerId },
      orderBy: { createdAt: "desc" },
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
        soldAt: true,
        category: {
          select: { id: true, name: true, slug: true },
        },
        images: {
          where: { processingStatus: "READY" },
          orderBy: { sortOrder: "asc" },
          select: { id: true, objectKey: true, sortOrder: true },
        },
      },
    }),
    prisma.listing.count({ where: { sellerId } }),
  ]);

  const items = listings.map((listing) => ({
    ...listing,
    images: withImageUrls(listing.images),
  }));

  return {
    items,
    listings: items,
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function getBuyerInquiries(
  buyerId: string,
  input: ListPublishedListingsInput,
) {
  const skip = (input.page - 1) * input.pageSize;

  const [inquiries, total] = await prisma.$transaction([
    prisma.listingInquiry.findMany({
      where: { buyerId },
      orderBy: { createdAt: "desc" },
      skip,
      take: input.pageSize,
      select: {
        id: true,
        message: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        listing: {
          select: {
            id: true,
            title: true,
            status: true,
            category: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
      },
    }),
    prisma.listingInquiry.count({ where: { buyerId } }),
  ]);

  return {
    inquiries: inquiries.map((inquiry) => ({
      id: inquiry.id,
      message: inquiry.message,
      status: inquiry.status,
      createdAt: inquiry.createdAt,
      updatedAt: inquiry.updatedAt,
      listing: inquiry.listing,
    })),
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function createListingInquiry(
  listingId: string,
  buyerId: string,
  message: string,
) {
  const listing = await prisma.listing.findFirst({
    where: {
      id: listingId,
      status: ListingStatus.PUBLISHED,
    },
    select: { id: true },
  });

  if (!listing) {
    throw new AppError(
      404,
      "LISTING_NOT_FOUND",
      "Listing not found or is no longer available.",
    );
  }

  return prisma.listingInquiry.create({
    data: {
      listingId: listing.id,
      buyerId,
      message,
    },
    select: {
      message: true,
      status: true,
      createdAt: true,
    },
  });
}

export async function getListingInquiries(
  listingId: string,
  sellerId: string,
) {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, sellerId: true },
  });

  if (!listing) {
    throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found.");
  }

  if (listing.sellerId !== sellerId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to view inquiries for this listing.",
    );
  }

  const inquiries = await prisma.listingInquiry.findMany({
    where: { listingId: listing.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      message: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      buyer: {
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

  return inquiries.map(({ buyer, ...inquiry }) => ({
    ...inquiry,
    buyer: {
      name: buyer.studentProfile?.displayName ?? "MUT student",
      verified: buyer.studentProfile?.verificationStatus === "APPROVED",
    },
  }));
}

export async function updateInquiryStatus(
  listingId: string,
  inquiryId: string,
  sellerId: string,
  status: ListingInquiryStatus,
) {
  await assertSellerAuthorized(sellerId);

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, sellerId: true },
  });

  if (!listing) {
    throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found.");
  }

  if (listing.sellerId !== sellerId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You do not have permission to update inquiries for this listing.",
    );
  }

  const inquiry = await prisma.listingInquiry.findUnique({
    where: { id: inquiryId },
    select: { id: true, listingId: true, status: true },
  });

  if (!inquiry) {
    throw new AppError(404, "INQUIRY_NOT_FOUND", "Inquiry not found.");
  }

  if (inquiry.listingId !== listingId) {
    throw new AppError(
      404,
      "INQUIRY_NOT_FOUND",
      "Inquiry not found for this listing.",
    );
  }

  const validTransitions: Record<ListingInquiryStatus, ListingInquiryStatus[]> = {
    OPEN: [ListingInquiryStatus.RESPONDED, ListingInquiryStatus.CLOSED],
    RESPONDED: [ListingInquiryStatus.CLOSED],
    CLOSED: [],
  };

  if (!validTransitions[inquiry.status].includes(status)) {
    throw new AppError(
      409,
      "INVALID_INQUIRY_STATUS",
      `This inquiry cannot transition from ${inquiry.status} to ${status}.`,
    );
  }

  const result = await prisma.listingInquiry.updateMany({
    where: {
      id: inquiryId,
      listingId,
      status: inquiry.status,
      listing: {
        sellerId,
      },
    },
    data: {
      status,
      updatedAt: new Date(),
    },
  });

  if (result.count !== 1) {
    throw new AppError(
      409,
      "INVALID_INQUIRY_STATUS",
      "The inquiry status changed before this update could be applied.",
    );
  }

  return prisma.listingInquiry.findUniqueOrThrow({
    where: { id: inquiryId },
    select: {
      id: true,
      status: true,
      updatedAt: true,
    },
  });
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

  const listing = await prisma.listing.update({
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

  return {
    ...listing,
    images: withImageUrls(listing.images),
  };
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

  if (existing.status === ListingStatus.SOLD) {
    throw new AppError(
      409,
      "INVALID_LISTING_STATUS",
      "A sold listing cannot be removed.",
    );
  }

  const result = await prisma.listing.updateMany({
    where: {
      id: existing.id,
      sellerId,
      status: { notIn: [ListingStatus.SOLD, ListingStatus.REMOVED] },
    },
    data: { status: ListingStatus.REMOVED },
  });

  if (result.count !== 1) {
    throw new AppError(
      409,
      "INVALID_LISTING_STATUS",
      "The listing status has changed. Please try again.",
    );
  }

  const listingImages = await prisma.listingImage.findMany({
    where: { listingId: existing.id },
    select: { objectKey: true },
  });

  await deleteListingImageFiles(listingImages.map((image) => image.objectKey));

  return prisma.listing.findUniqueOrThrow({
    where: { id: existing.id },
    select: {
      id: true,
      status: true,
      updatedAt: true,
    },
  });
}