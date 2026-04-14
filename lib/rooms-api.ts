import { apiRequest } from '@/lib/api-client';

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

export async function getRooms() {
  const response = await apiRequest<RoomsResponse>('/rooms/list', {
    auth: true,
  });
  return response.rooms;
}

export async function joinRoom(roomId: string) {
  await apiRequest<{ ok: boolean }>(`/rooms/join/${roomId}`, {
    method: 'POST',
    auth: true,
  });
}

export async function leaveRoom(roomId: string) {
  await apiRequest<{ ok: boolean }>(`/rooms/join/${roomId}`, {
    method: 'DELETE',
    auth: true,
  });
}
