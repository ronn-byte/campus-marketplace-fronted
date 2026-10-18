ALTER TABLE "listing_images"
  ADD COLUMN "uploadBatchId" UUID,
  ADD COLUMN "uploadBatchIndex" INTEGER,
  ADD COLUMN "contentSha256" CHAR(64);

CREATE UNIQUE INDEX "listing_images_listingId_uploadBatchId_uploadBatchIndex_key"
  ON "listing_images"("listingId", "uploadBatchId", "uploadBatchIndex");
