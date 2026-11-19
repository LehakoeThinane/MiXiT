import { refreshAccessToken } from '@/lib/api-client';
import { connectSocket, disconnectSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/stores/auth-store';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('@/lib/api-client', () => ({
  API_BASE_URL: 'http://api.test',
  refreshAccessToken: jest.fn(),
}));

type FakeSocket = {
  options: { auth: (send: (data: { token: string | null }) => void) => void };
  handlers: Record<string, (arg: unknown) => unknown>;
  on: jest.Mock;
  connect: jest.Mock;
  disconnect: jest.Mock;
};
const created: FakeSocket[] = [];
jest.mock('socket.io-client', () => ({
  io: jest.fn((_url: string, options: FakeSocket['options']) => {
    const socket: FakeSocket = {
      options,
      handlers: {},
      on: jest.fn((event: string, handler: (arg: unknown) => unknown) => {
        socket.handlers[event] = handler;
      }),
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    created.push(socket);
    return socket;
  }),
}));

const tokenSentOnConnect = (socket: FakeSocket) => {
  let sent: string | null = null;
  socket.options.auth(({ token }) => (sent = token));
  return sent;
};

beforeEach(() => {
  disconnectSocket();
  created.length = 0;
  jest.mocked(refreshAccessToken).mockReset();
  useAuthStore.setState({ accessToken: 'token-1', refreshToken: 'r' });
});

describe('realtime socket', () => {
  it('sends the CURRENT access token on every (re)connect', () => {
    const socket = connectSocket() as unknown as FakeSocket;
    expect(tokenSentOnConnect(socket)).toBe('token-1');

    useAuthStore.setState({ accessToken: 'token-2' }); // refreshed in the background
    expect(tokenSentOnConnect(socket)).toBe('token-2');
  });

  it('keeps one socket across token refreshes', () => {
    const first = connectSocket();
    useAuthStore.setState({ accessToken: 'token-2' });
    expect(connectSocket()).toBe(first);
    expect(created).toHaveLength(1);
  });

  it('refreshes the token and reconnects when the server rejects an expired token', async () => {
    jest.mocked(refreshAccessToken).mockResolvedValue('token-2');
    const socket = connectSocket() as unknown as FakeSocket;

    await socket.handlers.connect_error(new Error('Unauthorized'));

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect when the refresh fails (signed out)', async () => {
    jest.mocked(refreshAccessToken).mockResolvedValue(null);
    const socket = connectSocket() as unknown as FakeSocket;
    await socket.handlers.connect_error(new Error('Unauthorized'));
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('ignores other connection errors (Socket.IO retries those itself)', async () => {
    const socket = connectSocket() as unknown as FakeSocket;
    await socket.handlers.connect_error(new Error('xhr poll error'));
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});
