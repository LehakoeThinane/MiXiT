import { apiRequest } from '@/lib/api-client';

export type AuthUser = {
  id: string;
  phone: string;
};

type RequestOtpResponse = {
  ok: boolean;
  message: string;
  debugCode?: string;
};

type VerifyOtpResponse = {
  ok: boolean;
  user: AuthUser;
  tokens: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: string;
  };
};

export async function requestOtp(phone: string) {
  return apiRequest<RequestOtpResponse>('/auth/request-otp', {
    method: 'POST',
    body: { phone },
  });
}

export async function verifyOtp(phone: string, code: string) {
  return apiRequest<VerifyOtpResponse>('/auth/verify-otp', {
    method: 'POST',
    body: { phone, code },
  });
}

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

export async function getCurrentUser() {
  return apiRequest<MeResponse>('/auth/me', { auth: true });
}
