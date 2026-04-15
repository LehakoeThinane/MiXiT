-- AlterTable
ALTER TABLE "profiles"
ADD COLUMN "intents" JSONB,
ADD COLUMN "traits" JSONB,
ADD COLUMN "show_phone" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "show_last_seen" BOOLEAN NOT NULL DEFAULT true;

