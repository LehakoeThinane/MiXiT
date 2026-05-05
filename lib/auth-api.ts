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

// When EXPO_PUBLIC_MOCK_AUTH=true the app skips all network calls and uses a
// local mock so the full onboarding flow can be tested without a live backend.
const MOCK = process.env.EXPO_PUBLIC_MOCK_AUTH === 'true';
export const MOCK_OTP_CODE = '123456';

export async function requestOtp(phone: string): Promise<RequestOtpResponse> {
  if (MOCK) {
    console.log('[mock] requestOtp', phone, '→ code:', MOCK_OTP_CODE);
    return { ok: true, message: 'OTP sent (mock)', debugCode: MOCK_OTP_CODE };
  }
  return apiRequest<RequestOtpResponse>('/auth/request-otp', {
    method: 'POST',
    body: { phone },
  });
}

export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResponse> {
  if (MOCK) {
    if (code !== MOCK_OTP_CODE) {
      throw new Error(`Wrong mock code. Use ${MOCK_OTP_CODE}`);
    }
    console.log('[mock] verifyOtp success for', phone);
    return {
      ok: true,
      user: { id: 'mock-user-001', phone },
      tokens: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        tokenType: 'Bearer',
        expiresIn: '15m',
      },
    };
  }
  return apiRequest<VerifyOtpResponse>('/auth/verify-otp', {
    method: 'POST',
    body: { phone, code },
  });
}

export async function getCurrentUser(): Promise<MeResponse> {
  if (MOCK) {
    return { ok: true, user: null };
  }
  return apiRequest<MeResponse>('/auth/me', { auth: true });
}
