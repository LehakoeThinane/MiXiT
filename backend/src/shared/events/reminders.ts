import { prisma } from '../db/prisma.js';
import { sendPushNotifications } from '../push/expo-push.js';
import { logger } from '../utils/logger.js';

const CHECK_EVERY_MS = 60 * 1000;
const REMIND_BEFORE_MS = 15 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

async function sendDueReminders() {
  const now = Date.now();
  const due = await prisma.roomEvent.findMany({
    where: {
      cancelledAt: null,
      remindedAt: null,
      startsAt: { gte: new Date(now - 5 * 60 * 1000), lte: new Date(now + REMIND_BEFORE_MS) },
    },
    select: { id: true, title: true, roomId: true, startsAt: true },
    take: 50,
  });

  for (const event of due) {
    // Claim the reminder so multiple server instances never send it twice.
    const claimed = await prisma.roomEvent.updateMany({
      where: { id: event.id, remindedAt: null },
      data: { remindedAt: new Date() },
    });
    if (claimed.count !== 1) continue;

    const rsvps = await prisma.roomEventRsvp.findMany({
      where: { eventId: event.id },
      select: { user: { select: { profile: { select: { pushToken: true } } } } },
    });
    const minutes = Math.max(0, Math.round((event.startsAt.getTime() - Date.now()) / 60000));
    await sendPushNotifications(
      rsvps.map((r) => r.user.profile?.pushToken),
      minutes <= 1 ? 'Starting now' : `Starting in ${minutes} min`,
      event.title,
      { type: 'room_event', roomId: event.roomId, eventId: event.id }
    );
  }
}

/** Starts the in-process reminder loop. Note: on hosts that sleep when idle (e.g. a free plan), reminders can be late. */
export function startEventReminders() {
  if (timer) return;
  timer = setInterval(() => {
    sendDueReminders().catch((error) =>
      logger.warn('Event reminder run failed', { error: error instanceof Error ? error.message : String(error) })
    );
  }, CHECK_EVERY_MS);
  timer.unref();
}

export function stopEventReminders() {
  if (timer) clearInterval(timer);
  timer = null;
}
