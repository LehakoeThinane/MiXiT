-- Location privacy (readiness brief 1.5): store coordinates on a ~1 km grid
-- (2 decimal places) instead of exact positions. New writes are snapped by the
-- API (shared/location/privacy.ts); this snaps rows written before that.
-- Data-only and backward-compatible: old code reads rounded values unchanged.
UPDATE "profiles"
SET
  "location_lat" = ROUND("location_lat"::numeric, 2)::double precision,
  "location_lng" = ROUND("location_lng"::numeric, 2)::double precision
WHERE "location_lat" IS NOT NULL OR "location_lng" IS NOT NULL;
