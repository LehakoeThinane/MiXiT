-- Align room_messages with what Prisma generates for schema.prisma (caught by the
-- CI schema-drift check). The original hand-written migration created the foreign
-- keys without ON UPDATE CASCADE and gave "id" a database default, while Prisma
-- generates ids client-side.
ALTER TABLE "room_messages" DROP CONSTRAINT IF EXISTS "room_messages_room_id_fkey";
ALTER TABLE "room_messages" DROP CONSTRAINT IF EXISTS "room_messages_user_id_fkey";
ALTER TABLE "room_messages" ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- messages_recipient_read_at_idx (from 20260610000001) is kept and is now
-- declared in schema.prisma, so no change is needed for it here.
