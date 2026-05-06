import { io, type Socket } from 'socket.io-client';

import { API_BASE_URL } from '@/lib/api-client';

let socket: Socket | null = null;
let connectedToken: string | null = null;

export function connectSocket(accessToken: string) {
  if (socket?.connected && connectedToken === accessToken) return socket;

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  connectedToken = accessToken;
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
    connectedToken = null;
  }
}
