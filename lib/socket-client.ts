import { io, type Socket } from 'socket.io-client';

import { API_BASE_URL, refreshAccessToken } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

let socket: Socket | null = null;
let refreshingAfterReject = false;

/**
 * Opens the realtime connection for the signed-in user. One socket per session:
 * access-token refreshes don't reconnect it, because the server only checks the
 * token at the handshake.
 */
export function connectSocket() {
  if (socket) return socket;

  socket = io(API_BASE_URL, {
    transports: ['websocket', 'polling'],
    // A function, so every (re)connect sends the CURRENT access token. With
    // 15-minute tokens, a fixed token would be expired by the next reconnect.
    auth: (send) => send({ token: useAuthStore.getState().accessToken }),
  });

  // The server rejects expired tokens with "Unauthorized", and Socket.IO does not
  // retry after a rejection by the server — so refresh the token and reconnect once.
  socket.on('connect_error', async (error) => {
    if (error.message !== 'Unauthorized' || refreshingAfterReject) return;
    refreshingAfterReject = true;
    try {
      const token = await refreshAccessToken();
      if (token && socket) socket.connect();
    } finally {
      refreshingAfterReject = false;
    }
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
