-- Phase 1: room sessions/meetups with RSVPs, host flag, and referral tracking.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_host" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referral_code" TEXT,
ADD COLUMN     "referral_rewarded_at" TIMESTAMP(3),
ADD COLUMN     "referred_by_id" TEXT;

-- CreateTable
CREATE TABLE "room_events" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'session',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "venue" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "reminded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_event_rsvps" (
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_event_rsvps_pkey" PRIMARY KEY ("event_id","user_id")
);

-- CreateIndex
CREATE INDEX "room_events_room_id_starts_at_idx" ON "room_events"("room_id", "starts_at");

-- CreateIndex
CREATE INDEX "room_events_starts_at_idx" ON "room_events"("starts_at");

-- CreateIndex
CREATE INDEX "room_event_rsvps_user_id_idx" ON "room_event_rsvps"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE INDEX "users_referred_by_id_idx" ON "users"("referred_by_id");

-- AddForeignKey
ALTER TABLE "room_events" ADD CONSTRAINT "room_events_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_events" ADD CONSTRAINT "room_events_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_event_rsvps" ADD CONSTRAINT "room_event_rsvps_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "room_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_event_rsvps" ADD CONSTRAINT "room_event_rsvps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

