import { apiRequest } from '@/lib/api-client';

const MOCK = process.env.EXPO_PUBLIC_MOCK_AUTH === 'true';

export type RoomItem = {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  city: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
};

type RoomsResponse = {
  ok: boolean;
  rooms: RoomItem[];
};

const MOCK_ROOMS: RoomItem[] = [
  { id: 'r1', slug: 'jozi-creatives', name: 'Jozi Creatives', emoji: '🎨', city: 'Johannesburg', description: 'Designers, artists & makers in JHB', memberCount: 214, joined: false },
  { id: 'r2', slug: 'pta-professionals', name: 'PTA Professionals', emoji: '💼', city: 'Pretoria', description: 'Network, grow, and connect', memberCount: 89, joined: true },
  { id: 'r3', slug: 'cape-town-vibes', name: 'Cape Town Vibes', emoji: '🌊', city: 'Cape Town', description: 'For the ocean lovers', memberCount: 312, joined: false },
  { id: 'r4', slug: 'durban-foodies', name: 'Durban Foodies', emoji: '🍛', city: 'Durban', description: 'Eat your way through the city', memberCount: 156, joined: false },
];

export async function getRooms(): Promise<RoomItem[]> {
  if (MOCK) return MOCK_ROOMS;
  const response = await apiRequest<RoomsResponse>('/rooms/list', { auth: true });
  return response.rooms;
}

export async function joinRoom(roomId: string): Promise<void> {
  if (MOCK) return;
  await apiRequest<{ ok: boolean }>(`/rooms/join/${roomId}`, { method: 'POST', auth: true });
}

export async function leaveRoom(roomId: string): Promise<void> {
  if (MOCK) return;
  await apiRequest<{ ok: boolean }>(`/rooms/join/${roomId}`, { method: 'DELETE', auth: true });
}
