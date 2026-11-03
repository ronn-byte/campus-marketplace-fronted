-- Preserve every existing inquiry as its first buyer-authored message.
CREATE TYPE "InquiryMessageSender" AS ENUM ('BUYER', 'SELLER');

CREATE TABLE "listing_inquiry_messages" (
    "id" UUID NOT NULL,
    "inquiryId" UUID NOT NULL,
    "sender" "InquiryMessageSender" NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_inquiry_messages_pkey" PRIMARY KEY ("id")
);

INSERT INTO "listing_inquiry_messages" (
    "id",
    "inquiryId",
    "sender",
    "content",
    "sequence",
    "readAt",
    "createdAt"
)
SELECT
    gen_random_uuid(),
    "id",
    'BUYER'::"InquiryMessageSender",
    "message",
    1,
    "createdAt",
    "createdAt"
FROM "listing_inquiries";

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM "listing_inquiries")
       <> (SELECT COUNT(*) FROM "listing_inquiry_messages") THEN
        RAISE EXCEPTION 'Inquiry-message backfill count does not match inquiry count';
    END IF;
END
$$;

CREATE UNIQUE INDEX "listing_inquiry_messages_inquiryId_sequence_key"
    ON "listing_inquiry_messages"("inquiryId", "sequence");

CREATE INDEX "listing_inquiry_messages_inquiryId_sender_readAt_idx"
    ON "listing_inquiry_messages"("inquiryId", "sender", "readAt");

ALTER TABLE "listing_inquiry_messages"
    ADD CONSTRAINT "listing_inquiry_messages_inquiryId_fkey"
    FOREIGN KEY ("inquiryId") REFERENCES "listing_inquiries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "listing_inquiries" DROP COLUMN "message";
