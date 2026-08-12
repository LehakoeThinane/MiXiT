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
    profile: {
      displayName: string;
      age: number;
      gender: string;
      bio?: string | null;
    } | null;
  } | null;
};

export async function googleSignIn(idToken: string) {
  return apiRequest<AuthResponse>('/auth/google', {
    method: 'POST',
    body: { idToken },
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
