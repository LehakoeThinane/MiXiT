-- Enable RLS on users table.
-- All data access goes through the backend API (Prisma + service role),
-- which bypasses RLS. This blocks direct PostgREST access via anon/authenticated keys.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
