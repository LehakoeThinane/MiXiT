-- Moderation tooling: user suspension/holds and report review state.
ALTER TABLE "users" ADD COLUMN "banned_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "held_at" TIMESTAMP(3);

ALTER TABLE "reports" ADD COLUMN "evidence" TEXT;
ALTER TABLE "reports" ADD COLUMN "reviewed_at" TIMESTAMP(3);
ALTER TABLE "reports" ADD COLUMN "resolution" TEXT;
