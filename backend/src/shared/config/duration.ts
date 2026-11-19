const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

/**
 * Parses durations like "15m", "1h", "30d" (units s/m/h/d) into seconds.
 * Throws on anything else, or outside [minSeconds, maxSeconds], so a typo in a
 * token-lifetime setting fails boot instead of silently issuing odd tokens.
 */
export function parseDurationSeconds(
  name: string,
  input: string | undefined,
  fallback: string,
  bounds: { minSeconds: number; maxSeconds: number }
): number {
  const raw = (input ?? '').trim() || fallback;
  const match = /^(\d+)\s*([smhd])$/i.exec(raw);
  if (!match) throw new Error(`${name} must look like 15m, 1h or 30d (got "${raw}")`);
  const seconds = Number(match[1]) * UNIT_SECONDS[match[2].toLowerCase()];
  if (seconds < bounds.minSeconds || seconds > bounds.maxSeconds) {
    throw new Error(`${name}=${raw} is outside the allowed range`);
  }
  return seconds;
}
