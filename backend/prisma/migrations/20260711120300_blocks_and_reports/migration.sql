-- Minimal moderation primitives — a dating app with none of this (no block,
-- report, or way to stop unwanted contact) was a real product-safety gap.
CREATE TABLE "blocks" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blocks_blocker_id_blocked_id_key" ON "blocks"("blocker_id", "blocked_id");
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");

ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reported_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reports_reported_id_idx" ON "reports"("reported_id");
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
