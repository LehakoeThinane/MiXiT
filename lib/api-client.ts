import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { useAuthStore } from '@/stores/auth-store';

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function resolveExpoHostIp() {
  const constants = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
    manifest?: { debuggerHost?: string };
  };

  const hostUri =
    constants.expoConfig?.hostUri ??
    constants.manifest2?.extra?.expoClient?.hostUri ??
    constants.manifest?.debuggerHost;

  if (!hostUri || typeof hostUri !== 'string') return null;

  const host = hostUri.split(':')[0]?.trim();
  if (!host || host === '127.0.0.1' || host === 'localhost') return null;

  return host;
}

function resolveDefaultBaseUrl() {
  const expoHostIp = resolveExpoHostIp();

  if (Platform.OS === 'android' && !Constants.isDevice) {
    return 'http://10.0.2.2:4000';
  }

  if (expoHostIp) {
    return `http://${expoHostIp}:4000`;
  }

  return Platform.select({
    android: 'http://10.0.2.2:4000',
    default: 'http://127.0.0.1:4000',
  });
}

const defaultBaseUrl = resolveDefaultBaseUrl();

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? defaultBaseUrl;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  _retryAfterRefresh?: boolean;
};

type RefreshResponse = {
  ok: boolean;
  user: {
    id: string;
    phone: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
};

async function tryRefreshToken() {
  const { refreshToken, updateTokens, clearSession } = useAuthStore.getState();
  if (!refreshToken) return null;

  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    clearSession();
    return null;
  }

  const json = (await response.json()) as RefreshResponse;
  if (!json?.tokens?.accessToken || !json?.tokens?.refreshToken) {
    clearSession();
    return null;
  }

  updateTokens({
    accessToken: json.tokens.accessToken,
    refreshToken: json.tokens.refreshToken,
  });

  return json.tokens.accessToken;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false, _retryAfterRefresh = false } = options;
  const token = useAuthStore.getState().accessToken;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (auth && response.status === 401 && !_retryAfterRefresh) {
    const refreshedAccessToken = await tryRefreshToken();
    if (refreshedAccessToken) {
      return apiRequest<T>(path, {
        method,
        body,
        auth,
        _retryAfterRefresh: true,
      });
    }
  }

  if (!response.ok) {
    const message = typeof json.message === 'string' ? json.message : 'Request failed';
    throw new ApiError(response.status, message, json);
  }

  return json as T;
}
