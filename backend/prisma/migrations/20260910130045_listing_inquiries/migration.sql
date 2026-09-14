-- CreateEnum
CREATE TYPE "ListingInquiryStatus" AS ENUM ('OPEN', 'RESPONDED', 'CLOSED');

-- CreateTable
CREATE TABLE "listing_inquiries" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "status" "ListingInquiryStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_inquiries_listingId_status_createdAt_idx" ON "listing_inquiries"("listingId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "listing_inquiries_buyerId_status_createdAt_idx" ON "listing_inquiries"("buyerId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "listing_inquiries" ADD CONSTRAINT "listing_inquiries_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_inquiries" ADD CONSTRAINT "listing_inquiries_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
