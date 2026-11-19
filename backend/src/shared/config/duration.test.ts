import { describe, expect, it } from 'vitest';

import { parseDurationSeconds } from './duration.js';

const wide = { minSeconds: 1, maxSeconds: 10 * 365 * 86_400 };

describe('parseDurationSeconds', () => {
  it.each([
    ['45s', 45],
    ['15m', 900],
    ['1h', 3600],
    ['30d', 2_592_000],
    [' 2H ', 7200],
  ])('%s → %i seconds', (input, seconds) => {
    expect(parseDurationSeconds('X', input, '1h', wide)).toBe(seconds);
  });

  it('uses the fallback when unset or blank', () => {
    expect(parseDurationSeconds('X', undefined, '15m', wide)).toBe(900);
    expect(parseDurationSeconds('X', '   ', '15m', wide)).toBe(900);
  });

  it.each(['15', '1w', 'abc', '-5m', '1.5h'])('rejects "%s"', (input) => {
    expect(() => parseDurationSeconds('JWT_ACCESS_TTL', input, '15m', wide)).toThrow(/JWT_ACCESS_TTL/);
  });

  it('enforces bounds', () => {
    expect(() => parseDurationSeconds('X', '10s', '15m', { minSeconds: 60, maxSeconds: 86_400 })).toThrow(/range/);
    expect(() => parseDurationSeconds('X', '2d', '15m', { minSeconds: 60, maxSeconds: 86_400 })).toThrow(/range/);
  });
});
