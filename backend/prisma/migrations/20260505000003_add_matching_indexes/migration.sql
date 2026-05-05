-- Profile: completedAt + updatedAt DESC — candidates query filter + sort
CREATE INDEX "profiles_completed_at_updated_at_idx" ON "profiles" ("completed_at", "updated_at" DESC);

-- Profile: city + completedAt + updatedAt DESC — future geo/city filtering
CREATE INDEX "profiles_city_completed_at_updated_at_idx" ON "profiles" ("city", "completed_at", "updated_at" DESC);

-- Profile: lastActive DESC — recency queries
CREATE INDEX "profiles_last_active_idx" ON "profiles" ("last_active" DESC);

-- Vibe: replace old toUserId index with one that covers matchedAt sort
DROP INDEX IF EXISTS "vibes_to_user_id_created_at_idx";
CREATE INDEX "vibes_to_user_id_matched_at_created_at_idx" ON "vibes" ("to_user_id", "matched_at" DESC NULLS LAST, "created_at" DESC);

-- Vibe: fromUserId + matchedAt — stats count WHERE fromUserId AND matchedAt IS NOT NULL
CREATE INDEX "vibes_from_user_id_matched_at_idx" ON "vibes" ("from_user_id", "matched_at");

-- Message: standalone recipientId — conversations OR query
CREATE INDEX "messages_recipient_id_created_at_idx" ON "messages" ("recipient_id", "created_at" DESC);
