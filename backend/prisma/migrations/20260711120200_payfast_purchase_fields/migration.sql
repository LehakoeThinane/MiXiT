-- Payments were granting Premium for free with no real charge. This adds
-- the fields needed to track a real PayFast checkout end to end: a
-- merchant-generated reference (m_payment_id sent to PayFast), PayFast's
-- own payment id once confirmed, and a price snapshot so a later product
-- price change can't retroactively change what a past purchase "cost".
ALTER TABLE "user_purchases" ADD COLUMN "merchant_reference" TEXT;
ALTER TABLE "user_purchases" ADD COLUMN "gateway_payment_id" TEXT;
ALTER TABLE "user_purchases" ADD COLUMN "amount_in_cents" INTEGER;
ALTER TABLE "user_purchases" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ZAR';

ALTER TABLE "user_purchases" ALTER COLUMN "status" SET DEFAULT 'pending';

-- Backfill any pre-existing rows (dev/seed data) with a synthetic reference
-- and a zero-cost snapshot so the new NOT NULL constraints can be applied.
UPDATE "user_purchases" SET "merchant_reference" = md5("id" || clock_timestamp()::text) WHERE "merchant_reference" IS NULL;
UPDATE "user_purchases" SET "amount_in_cents" = 0 WHERE "amount_in_cents" IS NULL;

ALTER TABLE "user_purchases" ALTER COLUMN "merchant_reference" SET NOT NULL;
ALTER TABLE "user_purchases" ALTER COLUMN "amount_in_cents" SET NOT NULL;

CREATE UNIQUE INDEX "user_purchases_merchant_reference_key" ON "user_purchases"("merchant_reference");
CREATE UNIQUE INDEX "user_purchases_gateway_payment_id_key" ON "user_purchases"("gateway_payment_id");
