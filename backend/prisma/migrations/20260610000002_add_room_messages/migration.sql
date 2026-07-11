CREATE TABLE "room_messages" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "room_id"    TEXT        NOT NULL,
  "user_id"    TEXT        NOT NULL,
  "content"    TEXT        NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "room_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "room_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE,
  CONSTRAINT "room_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "room_messages_room_id_created_at_idx" ON "room_messages"("room_id", "created_at" DESC);
