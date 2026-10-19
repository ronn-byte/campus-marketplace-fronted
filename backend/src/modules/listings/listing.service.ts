import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Metadata } from "sharp";

import {
  AccountStatus,
  ListingCondition,
  ListingInquiryStatus,
  ListingStatus,
  Role,
  VerificationStatus,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { prisma } from "../../lib/prisma.js";
import {
  MAX_PUBLIC_LISTING_OFFSET,
  MAX_PUBLIC_LISTING_PAGE,
} from "./listing.schemas.js";
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

type ListPublishedListingsInput = {
  page: number;
  pageSize: number;
  q?: string | undefined;
  categoryId?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  condition?: ListingCondition | undefined;
  location?: string | undefined;
  sort?: "newest" | "price_asc" | "price_desc" | undefined;
};

type PublishListingInput = {
  listingId: string;
  sellerId: string;
};

type UpdateListingInput = {
  [Key in keyof CreateListingInput]?: CreateListingInput[Key] | undefined;
};

const eligiblePublishedListingWhere = {
  status: ListingStatus.PUBLISHED,
  category: { is: { isActive: true } },
  seller: {
    is: {
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      studentProfile: { is: { verificationStatus: VerificationStatus.APPROVED } },
    },
  },
} satisfies Prisma.ListingWhereInput;

async function normalizeListingImage(
  buffer: Buffer,
  declaredMimeType: string,
): Promise<Buffer> {
  const maxPixels = 40_000_000;

  let metadata: Metadata;

  try {
    metadata = await sharp(buffer, {
      limitInputPixels: maxPixels,
      failOn: "error",
    }).metadata();
  } catch {
    throw new AppError(
      422,
      "INVALID_IMAGE_CONTENT",
      "The uploaded file is not a valid, readable image.",
    );
  }

  let actualMimeType: string | undefined;

  switch (metadata.format) {
    case "jpeg":
      actualMimeType = "image/jpeg";
      break;
    case "png":
      actualMimeType = "image/png";
      break;
    case "webp":
      actualMimeType = "image/webp";
      break;
  }

  if (!actualMimeType) {
    throw new AppError(
      422,
      "INVALID_IMAGE_TYPE",
      "Only JPEG, PNG, and WebP images are allowed.",
    );
  }

  if (actualMimeType !== declaredMimeType) {
    throw new AppError(
      422,
      "INVALID_IMAGE_CONTENT",
      "The file contents do not match the declared image type.",
    );
  }

  let normalizedBuffer: Buffer;

  try {
    const image = sharp(buffer, {
      limitInputPixels: maxPixels,
      failOn: "error",
    }).rotate();

    switch (metadata.format) {
      case "jpeg":
        normalizedBuffer = await image
          .jpeg({ quality: 85, mozjpeg: true })
          .toBuffer();
        break;
      case "png":
        normalizedBuffer = await image.png().toBuffer();
        break;
      case "webp":
        normalizedBuffer = await image.webp({ quality: 85 }).toBuffer();
        break;
      default:
        throw new Error("Unsupported image format");
    }
  } catch {
    throw new AppError(
      422,
      "INVALID_IMAGE_CONTENT",
      "The uploaded image could not be safely processed.",
    );
  }

  if (normalizedBuffer.byteLength > MAX_LISTING_IMAGE_BYTES) {
    throw new AppError(
      422,
      "INVALID_IMAGE_SIZE",
      "The processed image must not exceed 5 MB.",
    );
  }

  return normalizedBuffer;
}

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
  creationKey?: string,
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

  const select = {
    id: true,
    sellerId: true,
    categoryId: true,
    title: true,
    description: true,
    price: true,
    condition: true,
    location: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    publishedAt: true,
    soldAt: true,
    category: true,
    images: true,
  } satisfies Prisma.ListingSelect;

  let listing;
  try {
    listing = await prisma.listing.create({
      data: {
        sellerId,
        categoryId: input.categoryId,
        title: input.title,
        description: input.description,
        price: input.price,
        condition: input.condition,
        location: input.location,
        status: ListingStatus.DRAFT,
        ...(creationKey ? { creationKey } : {}),
      },
      select,
    });
  } catch (error) {
    if (
      !creationKey ||
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }

    const previous = await prisma.listing.findUnique({
      where: { sellerId_creationKey: { sellerId, creationKey } },
      select,
    });
    if (!previous) throw error;
    if (previous.status !== ListingStatus.DRAFT) {
      throw new AppError(409, "INVALID_LISTING_STATUS", "This saved draft is no longer editable.");
    }

    const samePayload =
      previous.categoryId === input.categoryId &&
      previous.title === input.title &&
      previous.description === input.description &&
      Number(previous.price) === input.price &&
      previous.condition === input.condition &&
      previous.location === input.location;
    if (!samePayload) {
      throw new AppError(
        409,
        "LISTING_CREATION_RETRY_MISMATCH",
        "A draft from an earlier save already exists. Open it from My Listings before making further changes.",
      );
    }
    listing = previous;
  }

  return {
    ...listing,
    images: withImageUrls(listing.images),
  };
}

export async function addListingImages(
  listingId: string,
  sellerId: string,
  files: ListingImageUpload[],
  uploadBatchId?: string,
) {
  await assertListingImageManagement(listingId, sellerId);

  if (files.length === 0) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Please upload at least one image.",
    );
  }

  if (files.length > MAX_LISTING_IMAGES_PER_LISTING) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      `A listing may contain up to ${MAX_LISTING_IMAGES_PER_LISTING} images.`,
    );
  }

  const listing = await prisma.listing.findUniqueOrThrow({
    where: { id: listingId },
    select: { id: true },
  });

  const uploadedObjectKeys: string[] = [];
  let transactionStarted = false;

  const records: {
    listingId: string;
    objectKey: string;
    sortOrder: number;
    processingStatus: "READY";
    uploadBatchId: string | null;
    uploadBatchIndex: number | null;
    contentSha256: string;
  }[] = [];

  let nextSortOrder = 0;
  let duplicateBatch = false;
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
      if (
        buffer.byteLength === 0 ||
        buffer.byteLength > MAX_LISTING_IMAGE_BYTES
      ) {
        throw new AppError(
          422,
          "INVALID_IMAGE_SIZE",
          "Each image must not exceed 5 MB.",
        );
      }

      const normalizedBuffer = await normalizeListingImage(buffer, mimeType);
      const objectKey = createListingObjectKey(listingId, mimeType);
      await writeListingImageFile(objectKey, normalizedBuffer);
      uploadedObjectKeys.push(objectKey);

      records.push({
        listingId: listing.id,
        objectKey,
        sortOrder: index,
        processingStatus: "READY",
        uploadBatchId: uploadBatchId ?? null,
        uploadBatchIndex: uploadBatchId ? index : null,
        contentSha256: createHash("sha256").update(normalizedBuffer).digest("hex"),
      });
    }

    transactionStarted = true;
    await prisma.$transaction(async (transaction) => {
      // Serialize concurrent uploads for this listing before counting images
      // and assigning sort positions. The lock is held only for DB work.
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM listings WHERE id = ${listing.id}::uuid FOR UPDATE
      `;

      const current = await transaction.listing.findUnique({
        where: { id: listing.id },
        select: { sellerId: true, status: true },
      });
      if (!current || current.sellerId !== sellerId) {
        throw new AppError(404, "LISTING_NOT_FOUND", "Draft not found.");
      }
      if (current.status !== ListingStatus.DRAFT && current.status !== ListingStatus.PUBLISHED) {
        throw new AppError(
          409,
          "INVALID_LISTING_STATUS",
          "Images can only be changed on draft or published listings.",
        );
      }

      if (uploadBatchId) {
        const previousBatch = await transaction.listingImage.findMany({
          where: { listingId: listing.id, uploadBatchId },
          orderBy: { uploadBatchIndex: "asc" },
          select: {
            id: true,
            objectKey: true,
            sortOrder: true,
            processingStatus: true,
            uploadBatchIndex: true,
            contentSha256: true,
          },
        });
        if (previousBatch.length > 0) {
          const matches =
            previousBatch.length === records.length &&
            previousBatch.every((image, index) =>
              image.uploadBatchIndex === index &&
              image.contentSha256 === records[index]?.contentSha256,
            );
          if (!matches) {
            throw new AppError(
              409,
              "UPLOAD_RETRY_MISMATCH",
              "This upload retry does not match the previously saved image batch.",
            );
          }
          duplicateBatch = true;
          return;
        }
      }

      const existingCount = await transaction.listingImage.count({
        where: { listingId: listing.id, removedAt: null },
      });
      if (existingCount + files.length > MAX_LISTING_IMAGES_PER_LISTING) {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          `A listing may contain up to ${MAX_LISTING_IMAGES_PER_LISTING} images.`,
        );
      }
      const maxSortOrder = await transaction.listingImage.aggregate({
        where: { listingId: listing.id },
        _max: { sortOrder: true },
      });
      nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;
      await transaction.listingImage.createMany({
        data: records.map((record) => ({
          ...record,
          sortOrder: nextSortOrder + record.sortOrder,
        })),
      });
    });
  } catch (error) {
    if (uploadedObjectKeys.length > 0) {
      // A failed commit response can be ambiguous. Retain files on database
      // errors to avoid deleting files referenced by a transaction that may
      // have committed; pre-transaction validation/write failures are safe
      // to clean up.
      if (!transactionStarted || error instanceof AppError) {
        await deleteListingImageFiles(uploadedObjectKeys);
      }
    }

    throw error;
  }

  if (duplicateBatch && uploadedObjectKeys.length > 0) {
    await deleteListingImageFiles(uploadedObjectKeys);
  }

  // This query is after the commit boundary. If readback fails, keep the
  // committed rows and their files; the client can reload the draft.
  const images = await prisma.listingImage.findMany({
    where: uploadBatchId
      ? { listingId: listing.id, uploadBatchId, removedAt: null }
      : { listingId: listing.id, sortOrder: { gte: nextSortOrder }, removedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, objectKey: true, sortOrder: true, processingStatus: true },
  });
  return withImageUrls(images);
}

export async function assertListingImageManagement(
  listingId: string,
  sellerId: string,
) {
  await assertSellerAuthorized(sellerId);
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true, status: true },
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
  if (listing.status !== ListingStatus.DRAFT && listing.status !== ListingStatus.PUBLISHED) {
    throw new AppError(
      409,
      "INVALID_LISTING_STATUS",
      "Images can only be changed on draft or published listings.",
    );
  }
}

export async function removeListingImage(
  listingId: string,
  imageId: string,
  sellerId: string,
) {
  await assertSellerAuthorized(sellerId);

  return prisma.$transaction(async (transaction) => {
    // Serialize removals with uploads so active image counts and positions
    // stay consistent while removed rows remain available for recovery.
    await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listings WHERE id = ${listingId}::uuid FOR UPDATE
    `;

    const listing = await transaction.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true },
    });
    if (!listing) {
      throw new AppError(404, "LISTING_NOT_FOUND", "Listing not found.");
    }
    if (listing.sellerId !== sellerId) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to change this listing's images.");
    }
    if (listing.status !== ListingStatus.DRAFT && listing.status !== ListingStatus.PUBLISHED) {
      throw new AppError(409, "INVALID_LISTING_STATUS", "Images can only be changed on draft or published listings.");
    }

    const image = await transaction.listingImage.findFirst({
      where: { id: imageId, listingId, removedAt: null },
      select: { id: true },
    });
    if (!image) {
      throw new AppError(404, "LISTING_IMAGE_NOT_FOUND", "Image not found.");
    }

    const removedAt = new Date();
    const result = await transaction.listingImage.updateMany({
      where: { id: image.id, listingId, removedAt: null },
      data: { removedAt },
    });
    if (result.count !== 1) {
      throw new AppError(409, "LISTING_IMAGE_CHANGED", "This image has changed. Refresh and try again.");
    }
    return { id: image.id, removedAt };
  });
}


export async function publishListing(input: PublishListingInput) {
  // Authorization must happen before checking listing details.
  await assertSellerAuthorized(input.sellerId);

  return prisma.$transaction(async (transaction) => {
    const listing = await transaction.listing.findUnique({
      where: { id: input.listingId },
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

    const readyImageCount = await transaction.listingImage.count({
      where: {
        listingId: listing.id,
        processingStatus: "READY",
        removedAt: null,
      },
    });

    if (readyImageCount < 1) {
      throw new AppError(
        422,
        "LISTING_IMAGE_REQUIRED",
        "Upload at least one valid image before publishing.",
      );
    }

    // Only one request can successfully perform this draft transition.
    const updateResult = await transaction.listing.updateMany({
      where: {
        id: listing.id,
        sellerId: input.sellerId,
        status: ListingStatus.DRAFT,
      },
      data: {
        status: ListingStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });

    if (updateResult.count !== 1) {
      throw new AppError(
        409,
        "INVALID_LISTING_STATUS",
        "This listing has changed. Refresh and try again.",
      );
    }

    const publishedListing = await transaction.listing.findUnique({
      where: { id: listing.id },
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

    if (!publishedListing) {
      throw new AppError(
        500,
        "PUBLISH_FAILED",
        "The listing could not be retrieved after publishing.",
      );
    }

    return publishedListing;
  });
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
        ...(nextStatus === ListingStatus.SOLD
          ? { soldAt: new Date() }
          : {}),
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

export async function reserveListing(
  listingId: string,
  sellerId: string,
) {
  return transitionListing(
    listingId,
    sellerId,
    [ListingStatus.PUBLISHED],
    ListingStatus.RESERVED,
  );
}

export async function markListingSold(
  listingId: string,
  sellerId: string,
) {
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

export async function getPublishedListings(
  input: ListPublishedListingsInput,
) {
  const skip = (input.page - 1) * input.pageSize;
  if (
    !Number.isSafeInteger(input.page) || input.page < 1 || input.page > MAX_PUBLIC_LISTING_PAGE ||
    !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 50 ||
    !Number.isSafeInteger(skip) || skip > MAX_PUBLIC_LISTING_OFFSET
  ) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Please check the submitted query parameters.",
    );
  }
  const filters: Prisma.ListingWhereInput = {};
  if (input.q) {
    filters.OR = [
      { title: { contains: input.q, mode: "insensitive" } },
      { description: { contains: input.q, mode: "insensitive" } },
    ];
  }
  if (input.categoryId) filters.categoryId = input.categoryId;
  if (input.condition) filters.condition = input.condition;
  if (input.location) filters.location = { contains: input.location, mode: "insensitive" };
  if (input.minPrice !== undefined || input.maxPrice !== undefined) {
    filters.price = {
      ...(input.minPrice !== undefined ? { gte: input.minPrice } : {}),
      ...(input.maxPrice !== undefined ? { lte: input.maxPrice } : {}),
    };
  }
  const where: Prisma.ListingWhereInput = {
    AND: [eligiblePublishedListingWhere, filters],
  };
  const orderBy: Prisma.ListingOrderByWithRelationInput[] = input.sort === "price_asc"
    ? [{ price: "asc" }, { createdAt: "desc" }, { id: "asc" }]
    : input.sort === "price_desc"
      ? [{ price: "desc" }, { createdAt: "desc" }, { id: "asc" }]
      : [{ createdAt: "desc" }, { id: "asc" }];

  const [listings, total] = await prisma.$transaction([
    prisma.listing.findMany({
      where,
      orderBy,
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
          where: { processingStatus: "READY", removedAt: null },
          orderBy: { sortOrder: "asc" },
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
                verificationStatus: true,
              },
            },
          },
        },
      },
    }),
    prisma.listing.count({
      where,
    }),
  ]);

  return {
    listings: listings.map((listing) => ({
      ...listing,
      images: withImageUrls(listing.images),
      seller: {
        name: "MUT student",
        verified:
          listing.seller.studentProfile?.verificationStatus === VerificationStatus.APPROVED,
      },
    })),
    meta: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.ceil(total / input.pageSize),
    },
  };
}

export async function getPublicListing(listingId: string, viewerId?: string) {
  const listing = await prisma.listing.findFirst({
    where: {
      id: listingId,
      ...eligiblePublishedListingWhere,
    },
    select: {
      id: true,
      sellerId: true,
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
        where: { processingStatus: "READY", removedAt: null },
        orderBy: { sortOrder: "asc" },
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
    isOwner: Boolean(viewerId && listing.sellerId === viewerId),
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
          where: { processingStatus: "READY", removedAt: null },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            objectKey: true,
            sortOrder: true,
          },
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
              select: {
                id: true,
                name: true,
                slug: true,
              },
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
      ...eligiblePublishedListingWhere,
    },
    select: { id: true, sellerId: true },
  });

  if (!listing) {
    throw new AppError(
      404,
      "LISTING_NOT_FOUND",
      "Listing not found or is no longer available.",
    );
  }

  if (listing.sellerId === buyerId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You cannot inquire about your own listing.",
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
      verified:
        buyer.studentProfile?.verificationStatus === "APPROVED",
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

  const validTransitions: Record<
    ListingInquiryStatus,
    ListingInquiryStatus[]
  > = {
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
      listing: { sellerId },
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

  if (existing.status !== ListingStatus.DRAFT && existing.status !== ListingStatus.PUBLISHED) {
    throw new AppError(
      409,
      "INVALID_LISTING_STATUS",
      "Only draft or published listings can be edited.",
    );
  }

  if (existing.status === ListingStatus.PUBLISHED) {
    const disallowedFields = ["title", "categoryId", "condition", "location"]
      .filter((field) => input[field as keyof UpdateListingInput] !== undefined);
    if (disallowedFields.length > 0) {
      throw new AppError(
        422,
        "PUBLISHED_LISTING_FIELDS_RESTRICTED",
        "Published listings can only update price and description.",
      );
    }
  }

  if (input.categoryId !== undefined) {
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

  const updateResult = await prisma.listing.updateMany({
    where: {
      id: existing.id,
      sellerId,
      status: existing.status,
    },
    data: {
      ...(input.categoryId === undefined
        ? {}
        : { categoryId: input.categoryId }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.price === undefined ? {} : { price: input.price }),
      ...(input.condition === undefined
        ? {}
        : { condition: input.condition }),
      ...(input.location === undefined ? {} : { location: input.location }),
    },
  });

  if (updateResult.count !== 1) {
    throw new AppError(
      409,
      "INVALID_LISTING_STATUS",
      "The listing status changed before this update could be applied.",
    );
  }

  const listing = await prisma.listing.findUniqueOrThrow({
    where: { id: existing.id },
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
      where: { processingStatus: "READY", removedAt: null },
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

export async function removeListing(
  listingId: string,
  sellerId: string,
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
      "You do not have permission to remove this listing.",
    );
  }

  if (
    existing.status !== ListingStatus.DRAFT &&
    existing.status !== ListingStatus.PUBLISHED
  ) {
    throw new AppError(
      409,
      "INVALID_LISTING_STATUS",
      "Only draft or published listings can be removed.",
    );
  }

  const result = await prisma.listing.updateMany({
    where: {
      id: existing.id,
      sellerId,
      // Match the state we authorized above so a concurrent transition to a
      // non-removable state cannot be overwritten by this request.
      status: existing.status,
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

  // Removal is a soft status transition. Keep image files because the image
  // rows remain attached to the retained listing record.
  return prisma.listing.findUniqueOrThrow({
    where: { id: existing.id },
    select: {
      id: true,
      status: true,
      updatedAt: true,
    },
  });
}

/**
 * Retrieve a seller's own draft for editing.
 *
 * Authentication is enforced by the route. This function independently
 * verifies seller eligibility and restricts the database query to the
 * supplied seller ID and an editable listing status.
 */
export async function getSellerListingForEdit(
  listingId: string,
  sellerId: string,
) {
  await assertSellerAuthorized(sellerId);

  const listing = await prisma.listing.findFirst({
    where: {
      id: listingId,
      sellerId,
      status: { in: [ListingStatus.DRAFT, ListingStatus.PUBLISHED] },
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
      updatedAt: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      images: {
        where: { processingStatus: "READY", removedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          objectKey: true,
          sortOrder: true,
          processingStatus: true,
        },
      },
    },
  });

  if (!listing) {
    throw new AppError(
      404,
      "LISTING_NOT_FOUND",
      "The editable listing could not be found.",
    );
  }

  return {
    ...listing,
    images: withImageUrls(listing.images),
  };
}
