import { apiRequest } from '@/lib/api-client';

export type AuthUser = {
  id: string;
  email: string;
  phone: string | null;
};

type AuthResponse = {
  ok: boolean;
  user: AuthUser;
  tokens: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: string;
  };
};

type MeResponse = {
  ok: boolean;
  user: {
    id: string;
    email: string;
    phone: string | null;
    appleId?: string | null;
    googleId?: string | null;
    profile: {
      displayName: string;
      age: number;
      gender: string;
      bio?: string | null;
    } | null;
  } | null;
};

export async function googleSignIn(idToken: string, acceptedTerms: boolean) {
  return apiRequest<AuthResponse>('/auth/google', {
    method: 'POST',
    body: { idToken, acceptedTerms },
  });
}

export async function appleSignIn(identityToken: string, acceptedTerms: boolean) {
  return apiRequest<AuthResponse>('/auth/apple', {
    method: 'POST',
    body: { identityToken, acceptedTerms },
  });
}

/** Demo account for App Store / Google Play review teams. */
export async function reviewSignIn(email: string, password: string) {
  return apiRequest<AuthResponse>('/auth/review', {
    method: 'POST',
    body: { email, password },
  });
}

/** Revokes the refresh session server-side. Never throws — logout must always succeed locally. */
export async function logoutSession(refreshToken: string | null) {
  if (!refreshToken) return;
  await apiRequest('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
}

/** Permanently deletes the account and all its data. */
export async function deleteAccount(appleAuthorizationCode?: string) {
  await apiRequest('/auth/me', {
    method: 'DELETE',
    auth: true,
    body: appleAuthorizationCode ? { appleAuthorizationCode } : {},
    timeoutMs: 45_000,
  });
}

export async function updatePhone(phone: string) {
  return apiRequest<{ ok: boolean; phone: string }>('/auth/phone', {
    method: 'PUT',
    auth: true,
    body: { phone },
  });
}

export async function getCurrentUser() {
  return apiRequest<MeResponse>('/auth/me', { auth: true });
}
