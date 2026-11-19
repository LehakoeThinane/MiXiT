/**
 * Location privacy (brief 1.5).
 *
 * Exact distances let an attacker pin down where someone lives: fake your own
 * location three times, read "230m away" each time, and intersect the circles
 * (trilateration). Two defences, applied together:
 *
 *  1. Coordinates are snapped to a ~1 km grid BEFORE they are stored, so the
 *     database never holds a precise home location.
 *  2. Distances shown to other users are coarse bands, never metres or
 *     decimal kilometres.
 *
 * Raw coordinates are never returned to other users (only to their owner).
 */

/** 2 decimal places ≈ 1.1 km of latitude (less of longitude away from the equator). */
const GRID_DECIMALS = 2;

export function snapCoordinate(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** GRID_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Haversine distance between two lat/lng points in kilometres. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const BANDS: { maxKm: number; label: string }[] = [
  { maxKm: 2, label: 'Less than 2 km away' },
  { maxKm: 5, label: '2–5 km away' },
  { maxKm: 10, label: '5–10 km away' },
  { maxKm: 25, label: '10–25 km away' },
  { maxKm: 50, label: '25–50 km away' },
];

/** A coarse, human-readable distance band — never metres. */
export function distanceBand(km: number): string {
  return BANDS.find((band) => km < band.maxKm)?.label ?? '50+ km away';
}

type Place = { lat: number | null; lng: number | null; city: string | null };

/** What another user sees about how far away someone is. */
export function describeDistance(me: Place, them: Place): string {
  const [myLat, myLng, theirLat, theirLng] = [me.lat, me.lng, them.lat, them.lng].map(snapCoordinate);
  if (myLat !== null && myLng !== null && theirLat !== null && theirLng !== null) {
    return distanceBand(haversineKm(myLat, myLng, theirLat, theirLng));
  }
  if (me.city && them.city && me.city.trim().toLowerCase() === them.city.trim().toLowerCase()) {
    return 'Same city';
  }
  return 'Nearby';
}
