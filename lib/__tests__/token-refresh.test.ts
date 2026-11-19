import { apiRequest } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

describe('access-token refresh', () => {
  let refreshCalls: string[];

  beforeEach(() => {
    refreshCalls = [];
    useAuthStore.setState({ accessToken: 'expired', refreshToken: 'refresh-1', user: { id: 'u1', email: 'u@x', phone: null } });

    // Simulates the server: rotates refresh tokens and treats reuse as theft.
    let currentRefresh = 'refresh-1';
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        const sent = JSON.parse(String(init?.body)).refreshToken as string;
        refreshCalls.push(sent);
        if (sent !== currentRefresh) return json(401, { ok: false, message: 'Refresh token expired' });
        currentRefresh = `refresh-${refreshCalls.length + 1}`;
        return json(200, { ok: true, tokens: { accessToken: 'fresh', refreshToken: currentRefresh } });
      }
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      return auth === 'Bearer fresh' ? json(200, { ok: true, url }) : json(401, { ok: false, message: 'Unauthorized' });
    }) as unknown as typeof fetch;
  });

  it('sends ONE refresh when several requests hit 401 at once, and keeps the user signed in', async () => {
    const results = await Promise.all([
      apiRequest<{ url: string }>('/a', { auth: true }),
      apiRequest<{ url: string }>('/b', { auth: true }),
      apiRequest<{ url: string }>('/c', { auth: true }),
    ]);

    expect(refreshCalls).toEqual(['refresh-1']);
    expect(results.map((r) => r.url.split('/').pop())).toEqual(['a', 'b', 'c']);
    expect(useAuthStore.getState().accessToken).toBe('fresh');
    expect(useAuthStore.getState().refreshToken).toBe('refresh-2');
  });

  it('refreshes again later (the shared request is not cached forever)', async () => {
    await apiRequest('/a', { auth: true });
    useAuthStore.setState({ accessToken: 'expired' });
    await apiRequest('/b', { auth: true });
    expect(refreshCalls).toEqual(['refresh-1', 'refresh-2']);
  });
});
