ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "supabase_user_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_supabase_user_id_key"
ON "users" ("supabase_user_id");
