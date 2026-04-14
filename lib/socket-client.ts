import { io, type Socket } from 'socket.io-client';

import { API_BASE_URL } from '@/lib/api-client';

let socket: Socket | null = null;

export function connectSocket(accessToken: string) {
  if (socket?.connected) return socket;

  socket = io(API_BASE_URL, {
    transports: ['websocket', 'polling'],
    auth: { token: accessToken },
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
