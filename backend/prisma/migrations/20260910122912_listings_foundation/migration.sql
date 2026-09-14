-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RESERVED', 'SOLD', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ListingCondition" AS ENUM ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'USED');

-- CreateEnum
CREATE TYPE "ImageProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "condition" "ListingCondition" NOT NULL,
    "location" VARCHAR(120) NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "soldAt" TIMESTAMPTZ(3),

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_images" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "objectKey" VARCHAR(500) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "processingStatus" "ImageProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_isActive_idx" ON "categories"("isActive");

-- CreateIndex
CREATE INDEX "listings_sellerId_status_createdAt_idx" ON "listings"("sellerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "listings_categoryId_status_createdAt_idx" ON "listings"("categoryId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "listings_status_createdAt_idx" ON "listings"("status", "createdAt");

-- CreateIndex
CREATE INDEX "listing_images_listingId_processingStatus_idx" ON "listing_images"("listingId", "processingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "listing_images_listingId_sortOrder_key" ON "listing_images"("listingId", "sortOrder");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
