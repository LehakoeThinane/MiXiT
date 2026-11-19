/**
 * What other users may see about someone. Never includes email or phone — those
 * are returned only to their owner (/auth/*, /profiles/me) and to admins.
 */

export const FALLBACK_DISPLAY_NAME = 'MiXiT user';
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

type PresenceFields = { lastActive: Date | null; showLastSeen: boolean } | null | undefined;

/** Online in the last 5 minutes — and false when the user hides their last seen. */
export function isOnline(profile: PresenceFields): boolean {
  if (!profile?.showLastSeen || !profile.lastActive) return false;
  return Date.now() - profile.lastActive.getTime() <= ONLINE_WINDOW_MS;
}

export function publicIdentity(
  userId: string,
  profile: ({ displayName: string } & NonNullable<PresenceFields>) | null | undefined
) {
  const displayName = profile?.displayName?.trim() || FALLBACK_DISPLAY_NAME;
  return {
    id: userId,
    displayName,
    initial: displayName.slice(0, 1).toUpperCase(),
    online: isOnline(profile),
  };
}
