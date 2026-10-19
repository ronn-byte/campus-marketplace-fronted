ALTER TABLE "listing_images"
  ADD COLUMN "removedAt" TIMESTAMPTZ(3);

CREATE INDEX "listing_images_listingId_removedAt_processingStatus_idx"
  ON "listing_images"("listingId", "removedAt", "processingStatus");
