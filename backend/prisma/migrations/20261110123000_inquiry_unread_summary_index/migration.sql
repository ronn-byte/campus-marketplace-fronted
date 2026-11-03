CREATE INDEX "listing_inquiry_messages_sender_readAt_inquiryId_idx"
    ON "listing_inquiry_messages"("sender", "readAt", "inquiryId");
