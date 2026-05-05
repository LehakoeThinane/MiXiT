import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';

type SupabaseAuthUser = {
  id: string;
  phone?: string | null;
  email?: string | null;
  aud?: string;
  created_at?: string;
  confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

type SupabaseSessionResponse = {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  user?: SupabaseAuthUser;
};

export type AuthenticatedUser = {
  sub: string;
  phone: string;
  supabaseUserId: string;
};

export function resolveBearerToken(input: string | string[] | undefined) {
  if (typeof input === 'string' && input.startsWith('Bearer ')) {
    return input.slice('Bearer '.length).trim();
  }
  if (Array.isArray(input) && input[0]?.startsWith('Bearer ')) {
    return input[0].slice('Bearer '.length).trim();
  }
  return null;
}

function normalizePhone(input: string) {
  return input.replace(/\s+/g, '').trim();
}

function buildAuthHeaders(accessToken?: string) {
  const headers: Record<string, string> = {
    apikey: env.supabaseAnonKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

async function supabaseAuthRequest<T>(
  path: string,
  init: RequestInit,
  accessToken?: string
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${env.supabaseUrl}${path}`, {
      ...init,
      headers: {
        ...buildAuthHeaders(accessToken),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let json = {} as T;
    if (text) {
      try {
        json = JSON.parse(text) as T;
      } catch {
        json = {} as T;
      }
    }

    if (!response.ok) {
      const message =
        typeof (json as { msg?: unknown; error_description?: unknown; message?: unknown }).message === 'string'
          ? (json as { message: string }).message
          : typeof (json as { msg?: unknown }).msg === 'string'
            ? (json as { msg: string }).msg
            : typeof (json as { error_description?: unknown }).error_description === 'string'
              ? (json as { error_description: string }).error_description
              : `Supabase Auth request failed (${response.status})`;

      throw new Error(message);
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function syncLocalUserFromSupabaseUser(user: SupabaseAuthUser) {
  const phone = normalizePhone(user.phone ?? '');
  if (!phone) {
    throw new Error('Supabase user is missing a phone number');
  }

  const existingBySupabase = await prisma.user.findUnique({
    where: { supabaseUserId: user.id },
  });
  if (existingBySupabase) {
    if (existingBySupabase.phone !== phone) {
      return prisma.user.update({
        where: { id: existingBySupabase.id },
        data: { phone },
      });
    }

    return existingBySupabase;
  }

  const existingByPhone = await prisma.user.findUnique({
    where: { phone },
  });
  if (existingByPhone) {
    return prisma.user.update({
      where: { id: existingByPhone.id },
      data: { supabaseUserId: user.id },
    });
  }

  return prisma.user.create({
    data: {
      phone,
      supabaseUserId: user.id,
    },
  });
}

export async function requestSupabaseOtp(phone: string) {
  await supabaseAuthRequest(
    '/auth/v1/otp',
    {
      method: 'POST',
      body: JSON.stringify({
        phone,
        channel: 'sms',
        create_user: true,
        should_create_user: true,
      }),
    }
  );
}

export async function verifySupabaseOtp(phone: string, token: string) {
  const session = await supabaseAuthRequest<SupabaseSessionResponse>(
    '/auth/v1/verify',
    {
      method: 'POST',
      body: JSON.stringify({
        phone,
        token,
        type: 'sms',
      }),
    }
  );

  if (!session.access_token || !session.refresh_token) {
    throw new Error('Supabase Auth did not return a session');
  }

  return session;
}

export async function refreshSupabaseSession(refreshToken: string) {
  const session = await supabaseAuthRequest<SupabaseSessionResponse>(
    '/auth/v1/token?grant_type=refresh_token',
    {
      method: 'POST',
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    }
  );

  if (!session.access_token || !session.refresh_token) {
    throw new Error('Supabase Auth did not return a refreshed session');
  }

  return session;
}

export async function resolveAuthenticatedUser(accessToken: string): Promise<AuthenticatedUser> {
  const supabaseUser = await supabaseAuthRequest<SupabaseAuthUser>(
    '/auth/v1/user',
    { method: 'GET' },
    accessToken
  );

  const localUser = await syncLocalUserFromSupabaseUser(supabaseUser);

  return {
    sub: localUser.id,
    phone: localUser.phone,
    supabaseUserId: supabaseUser.id,
  };
}

export async function authenticateSupabaseToken(accessToken: string): Promise<AuthenticatedUser> {
  return resolveAuthenticatedUser(accessToken);
}
