-- "read_at" was already added by the init migration; this one duplicated it
-- and fails on any fresh database. Made idempotent so it can run anywhere,
-- including databases that only had it added out-of-band.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "messages_recipient_read_at_idx" ON "messages"("recipient_id", "read_at");
