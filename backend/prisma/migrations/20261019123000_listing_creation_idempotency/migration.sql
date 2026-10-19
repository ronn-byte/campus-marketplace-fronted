ALTER TABLE "listings"
  ADD COLUMN "creationKey" UUID;

CREATE UNIQUE INDEX "listings_sellerId_creationKey_key"
  ON "listings"("sellerId", "creationKey");
