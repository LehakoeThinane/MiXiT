import { apiRequest } from '@/lib/api-client';

export type RoomEventKind = 'session' | 'meetup';

export type RoomEvent = {
  id: string;
  roomId: string;
  roomName: string;
  roomEmoji: string;
  kind: RoomEventKind;
  title: string;
  description: string | null;
  venue: string | null;
  startsAt: string;
  endsAt: string | null;
  hostName: string;
  rsvpCount: number;
  going: boolean;
  isLive: boolean;
  canCancel: boolean;
};

type EventsResponse = { ok: boolean; canHost: boolean; events: RoomEvent[] };

export async function getRoomEvents(roomId: string) {
  return apiRequest<EventsResponse>(`/events/room/${roomId}`, { auth: true });
}

export async function getUpcomingEvents() {
  return apiRequest<EventsResponse>('/events/upcoming', { auth: true });
}

export async function createRoomEvent(
  roomId: string,
  input: { kind: RoomEventKind; title: string; description?: string; venue?: string; startsAt: string; endsAt?: string }
) {
  const response = await apiRequest<{ ok: boolean; event: RoomEvent }>(`/events/room/${roomId}`, {
    method: 'POST',
    auth: true,
    body: input,
  });
  return response.event;
}

export async function cancelRoomEvent(eventId: string) {
  await apiRequest(`/events/${eventId}`, { method: 'DELETE', auth: true });
}

export async function setRsvp(eventId: string, going: boolean) {
  await apiRequest(`/events/${eventId}/rsvp`, { method: going ? 'POST' : 'DELETE', auth: true });
}

/** e.g. "Live now", "Today 20:00", "Fri 7 Nov 20:00" in the phone's local time. */
export function formatEventTime(startsAt: string, isLive = false) {
  if (isLive) return 'Live now';
  const date = new Date(startsAt);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return `Today ${time}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}
