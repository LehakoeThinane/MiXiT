-- Sign in with Apple (App Store guideline 4.8) alongside Google, plus a record
-- of when each user accepted the Terms of Use / Privacy Policy.
ALTER TABLE "users" ALTER COLUMN "google_id" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "apple_id" TEXT;
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_apple_id_key" ON "users"("apple_id");
