import { describe, expect, it } from 'vitest';

import { describeDistance, distanceBand, haversineKm, snapCoordinate } from './privacy.js';

// Soweto-ish origin; offsets in degrees of latitude (1° ≈ 111 km).
const origin = { lat: -26.2485, lng: 27.854, city: 'Soweto' };
const northBy = (metres: number) => ({ lat: origin.lat + metres / 111_000, lng: origin.lng, city: 'Soweto' });

describe('snapCoordinate', () => {
  it('rounds to 2 decimal places (~1 km grid)', () => {
    expect(snapCoordinate(-26.248512345)).toBe(-26.25);
    expect(snapCoordinate(27.8549)).toBe(27.85);
  });

  it('passes through missing values', () => {
    expect(snapCoordinate(null)).toBeNull();
    expect(snapCoordinate(undefined)).toBeNull();
    expect(snapCoordinate(Number.NaN)).toBeNull();
  });
});

describe('distanceBand', () => {
  it.each([
    [0.05, 'Less than 2 km away'],
    [1.99, 'Less than 2 km away'],
    [3.4, '2–5 km away'],
    [7, '5–10 km away'],
    [18, '10–25 km away'],
    [40, '25–50 km away'],
    [900, '50+ km away'],
  ])('%s km → %s', (km, label) => {
    expect(distanceBand(km)).toBe(label);
  });

  it('never shows metres or decimal kilometres', () => {
    for (let km = 0; km < 120; km += 0.137) {
      expect(distanceBand(km)).not.toMatch(/\d+m away|\d\.\d/);
    }
  });
});

describe('describeDistance', () => {
  it('gives users 150 m and 900 m away the same answer', () => {
    expect(describeDistance(origin, northBy(150))).toBe(describeDistance(origin, northBy(900)));
  });

  it('cannot be narrowed below the grid by moving the viewer', () => {
    // Attacker "walks" their own position in 50 m steps; the answer about the target
    // must stay coarse (never metres) at every step.
    const target = northBy(300);
    for (let step = 0; step < 40; step++) {
      expect(describeDistance(northBy(step * 50), target)).toMatch(/^(Less than 2 km|2–5 km) away$/);
    }
  });

  it('falls back to city, then Nearby, without coordinates', () => {
    expect(describeDistance({ lat: null, lng: null, city: 'Soweto' }, { lat: null, lng: null, city: ' soweto ' })).toBe('Same city');
    expect(describeDistance({ lat: null, lng: null, city: 'Soweto' }, { lat: null, lng: null, city: 'Durban' })).toBe('Nearby');
  });

  it('keeps haversine accurate', () => {
    expect(haversineKm(-26.2041, 28.0473, -33.9249, 18.4241)).toBeCloseTo(1263, -1); // JHB → CPT
  });
});
