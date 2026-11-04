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
  timeoutMs?: number;
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

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Offline / server unreachable: keep the session (don't log the user out over a
    // network blip) and let the original request's error surface instead.
    return null;
  }

  if (!response.ok) {
    // Only a definite rejection of the refresh token ends the session; a server
    // outage (5xx) must not log everyone out.
    if (response.status === 401 || response.status === 403) clearSession();
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
  const { method = 'GET', body, auth = false, timeoutMs = 25_000, _retryAfterRefresh = false } = options;
  const token = useAuthStore.getState().accessToken;
  const hasJsonBody = body !== undefined && body !== null;

  const headers: Record<string, string> = {
    'ngrok-skip-browser-warning': '1',
  };
  if (hasJsonBody) {
    headers['Content-Type'] = 'application/json';
  }

  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: hasJsonBody ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    // Don't use `instanceof DOMException`: Hermes (React Native) has no DOMException
    // global, so that check itself throws a ReferenceError and hides the real error.
    if ((error as { name?: string } | null)?.name === 'AbortError') {
      throw new ApiError(0, 'Request timed out. Check your connection and try again.');
    }
    // fetch rejects with a TypeError ("Network request failed") when the server
    // can't be reached at all — offline, DNS failure, or the API is down.
    throw new ApiError(0, "Can't reach MiXiT right now. Check your connection and try again.");
  }
  clearTimeout(timer);

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
    // MiXiT API errors always carry `ok: false`. A 5xx without it came from the
    // hosting layer (e.g. "Application failed to respond") — show a friendly message.
    const fromMixitApi = json.ok === false;
    if (response.status >= 500 && !fromMixitApi) {
      throw new ApiError(response.status, 'MiXiT is temporarily unavailable. Please try again in a few minutes.', json);
    }
    const message = typeof json.message === 'string' ? json.message : `Request failed (${response.status})`;
    throw new ApiError(response.status, message, json);
  }

  return json as T;
}
