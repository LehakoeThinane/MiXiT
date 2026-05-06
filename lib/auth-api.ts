import { apiRequest } from '@/lib/api-client';

export type AuthUser = {
  id: string;
  phone: string;
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
    phone: string;
    profile: {
      displayName: string;
      age: number;
      gender: string;
      bio?: string | null;
    } | null;
  } | null;
};

export async function register(phone: string, password: string) {
  return apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: { phone, password },
  });
}

export async function login(phone: string, password: string) {
  return apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { phone, password },
  });
}

export async function getCurrentUser() {
  return apiRequest<MeResponse>('/auth/me', { auth: true });
}
