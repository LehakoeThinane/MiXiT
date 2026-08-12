-- Pre-launch: dropping phone+password auth for Google OAuth. Phone had no
-- verification at all (register with any unverified number), and Google
-- Sign-In offloads identity/anti-bot verification instead of building a
-- custom OTP flow. No production users to migrate — wipe existing accounts
-- (confirmed) rather than backfilling email/google_id.
TRUNCATE TABLE "users" CASCADE;

ALTER TABLE "users" DROP COLUMN "password_hash";
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "email" TEXT NOT NULL;
ALTER TABLE "users" ADD COLUMN "google_id" TEXT NOT NULL;

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
