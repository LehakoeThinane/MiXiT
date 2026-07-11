ALTER TABLE "messages" ADD COLUMN "read_at" TIMESTAMP(3);
CREATE INDEX "messages_recipient_read_at_idx" ON "messages"("recipient_id", "read_at");
