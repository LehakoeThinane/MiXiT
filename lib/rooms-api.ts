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
  nextEvent: { title: string; kind: 'session' | 'meetup'; startsAt: string; isLive: boolean } | null;
};

export type RoomMessage = {
  id: string;
  roomId: string;
  userId: string;
  senderName: string;
  content: string;
  createdAt: string;
};

type RoomsResponse = {
  ok: boolean;
  rooms: RoomItem[];
};

type RoomMessagesResponse = {
  ok: boolean;
  messages: RoomMessage[];
};

export async function getRooms() {
  const response = await apiRequest<RoomsResponse>('/rooms/list', { auth: true });
  return response.rooms;
}

export async function joinRoom(roomId: string) {
  await apiRequest<{ ok: boolean }>(`/rooms/join/${roomId}`, { method: 'POST', auth: true });
}

export async function leaveRoom(roomId: string) {
  await apiRequest<{ ok: boolean }>(`/rooms/join/${roomId}`, { method: 'DELETE', auth: true });
}

export async function getRoomMessages(roomId: string) {
  const response = await apiRequest<RoomMessagesResponse>(`/rooms/${roomId}/messages`, { auth: true });
  return response.messages;
}

export async function sendRoomMessage(roomId: string, content: string) {
  const response = await apiRequest<{ ok: boolean; message: RoomMessage }>(`/rooms/${roomId}/messages`, {
    method: 'POST',
    auth: true,
    body: { content },
  });
  return response.message;
}
