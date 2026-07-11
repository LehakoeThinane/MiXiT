-- Drop supabase_user_id — vestige of an abandoned Supabase Auth integration;
-- the app has always used its own phone/password + JWT auth, and nothing in
-- src/ ever read or wrote this column.
DROP INDEX IF EXISTS "users_supabase_user_id_key";

ALTER TABLE "users" DROP COLUMN IF EXISTS "supabase_user_id";
