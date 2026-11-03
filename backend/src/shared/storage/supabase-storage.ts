import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const BUCKET = 'profile-photos';
const CHAT_BUCKET = 'chat-media';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB
const AUDIO_TYPES = ['audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// profile-photos: PUBLIC — profile photos and voice intros are meant to be seen by
// other users. chat-media: PRIVATE — direct-message photos/voice notes are only
// served through short-lived signed URLs to the two people in the conversation.
const BUCKET_CONFIG = {
  [BUCKET]: { public: true, fileSizeLimit: MAX_AUDIO_BYTES, allowedMimeTypes: [...IMAGE_TYPES, ...AUDIO_TYPES] },
  [CHAT_BUCKET]: { public: false, fileSizeLimit: MAX_AUDIO_BYTES, allowedMimeTypes: [...IMAGE_TYPES, ...AUDIO_TYPES] },
} as const;

function serviceHeaders(): Record<string, string> {
  return {
    apikey: env.supabaseServiceRoleKey,
    Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

/** Creates the bucket, or brings an existing one in line with BUCKET_CONFIG. */
async function ensureBucket(bucket: keyof typeof BUCKET_CONFIG): Promise<void> {
  const config = BUCKET_CONFIG[bucket];
  const check = await fetch(`${env.supabaseUrl}/storage/v1/bucket/${bucket}`, { headers: serviceHeaders() });

  const response = check.ok
    ? await fetch(`${env.supabaseUrl}/storage/v1/bucket/${bucket}`, {
        method: 'PUT',
        headers: serviceHeaders(),
        body: JSON.stringify({ id: bucket, ...config }),
      })
    : await fetch(`${env.supabaseUrl}/storage/v1/bucket`, {
        method: 'POST',
        headers: serviceHeaders(),
        body: JSON.stringify({ id: bucket, name: bucket, ...config }),
      });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to ${check.ok ? 'update' : 'create'} storage bucket ${bucket}: ${text}`);
  }
}

export async function ensureStorageBucket(): Promise<void> {
  if (!env.supabaseServiceRoleKey) {
    logger.warn('SUPABASE_SERVICE_ROLE_KEY not set — photo uploads disabled');
    return;
  }
  await ensureBucket(BUCKET);
}

export async function ensureChatMediaBucket(): Promise<void> {
  if (!env.supabaseServiceRoleKey) return;
  await ensureBucket(CHAT_BUCKET);
}

// ---------------------------------------------------------------------------
// Ownership checks — clients send back the URLs they uploaded to; only accept
// objects inside the sender's own folder of the expected bucket.
// ---------------------------------------------------------------------------

/** Supabase returns signed paths relative to /storage/v1 (older versions include it). */
function absoluteStorageUrl(relative: string) {
  const path = relative.startsWith('/') ? relative : `/${relative}`;
  return path.startsWith('/storage/v1/') ? `${env.supabaseUrl}${path}` : `${env.supabaseUrl}/storage/v1${path}`;
}

function publicPrefix(bucket: string) {
  return `${env.supabaseUrl}/storage/v1/object/public/${bucket}/`;
}

export function isOwnProfileMediaUrl(url: string, userId: string): boolean {
  if (!env.supabaseUrl) return true; // storage not configured (local dev)
  return url.startsWith(`${publicPrefix(BUCKET)}${userId}/`) && !url.includes('..');
}

export function isOwnChatMediaUrl(url: string, userId: string): boolean {
  if (!env.supabaseUrl) return true;
  return url.startsWith(`${publicPrefix(CHAT_BUCKET)}${userId}/`) && !url.includes('..');
}

// ---------------------------------------------------------------------------
// Signed read URLs for private chat media. Messages keep storing the canonical
// object URL; it is swapped for a 1-hour signed URL whenever it is sent to a client.
// ---------------------------------------------------------------------------

const SIGNED_URL_TTL_SEC = 60 * 60;
const SIGNED_URL_CACHE_MS = 50 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export async function signChatMediaUrls(urls: (string | null | undefined)[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!env.supabaseServiceRoleKey || !env.supabaseUrl) return result;

  const prefix = publicPrefix(CHAT_BUCKET);
  const now = Date.now();
  const toSign: string[] = [];
  for (const url of new Set(urls)) {
    if (!url || !url.startsWith(prefix)) continue;
    const cached = signedUrlCache.get(url);
    if (cached && cached.expiresAt > now) result.set(url, cached.url);
    else toSign.push(url);
  }
  if (toSign.length === 0) return result;

  try {
    const response = await fetch(`${env.supabaseUrl}/storage/v1/object/sign/${CHAT_BUCKET}`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SEC, paths: toSign.map((url) => url.slice(prefix.length)) }),
    });
    if (!response.ok) throw new Error(`sign failed (${response.status})`);
    const signed = (await response.json()) as { path: string | null; signedURL: string | null; error: string | null }[];
    for (const item of signed) {
      if (!item.path || !item.signedURL) continue;
      const original = `${prefix}${item.path}`;
      const full = absoluteStorageUrl(item.signedURL);
      result.set(original, full);
      signedUrlCache.set(original, { url: full, expiresAt: now + SIGNED_URL_CACHE_MS });
    }
  } catch (error) {
    logger.warn('Chat media signing failed', { error: String(error) });
  }

  if (signedUrlCache.size > 5000) {
    for (const [key, value] of signedUrlCache) if (value.expiresAt <= now) signedUrlCache.delete(key);
  }
  return result;
}

export async function signChatMediaUrl(url: string | null): Promise<string | null> {
  if (!url) return url;
  return (await signChatMediaUrls([url])).get(url) ?? url;
}

export async function createSignedVoiceIntroUploadUrl(
  userId: string
): Promise<{ signedUrl: string; publicUrl: string }> {
  if (!env.supabaseServiceRoleKey) {
    throw new Error('Uploads are not configured — set SUPABASE_SERVICE_ROLE_KEY');
  }
  const objectPath = `${userId}/voice-intro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.m4a`;
  const response = await fetch(`${env.supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(`Supabase Storage sign failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { url: string };
  return {
    signedUrl: absoluteStorageUrl(data.url),
    publicUrl: `${publicPrefix(BUCKET)}${objectPath}`,
  };
}

export async function createSignedChatMediaUrl(
  userId: string,
  filename: string
): Promise<{ signedUrl: string; publicUrl: string }> {
  if (!env.supabaseServiceRoleKey) {
    throw new Error('Media uploads are not configured — set SUPABASE_SERVICE_ROLE_KEY');
  }

  const ext = filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const objectPath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const response = await fetch(
    `${env.supabaseUrl}/storage/v1/object/upload/sign/${CHAT_BUCKET}/${objectPath}`,
    { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({}) }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase Storage sign failed: ${text}`);
  }

  const data = (await response.json()) as { url: string };
  return {
    signedUrl: `${env.supabaseUrl}${data.url}`,
    publicUrl: `${env.supabaseUrl}/storage/v1/object/public/${CHAT_BUCKET}/${objectPath}`,
  };
}

export async function createSignedUploadUrl(
  userId: string,
  filename: string
): Promise<{ signedUrl: string; publicUrl: string }> {
  if (!env.supabaseServiceRoleKey) {
    throw new Error('Photo uploads are not configured — set SUPABASE_SERVICE_ROLE_KEY');
  }

  const ext = filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const objectPath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const response = await fetch(
    `${env.supabaseUrl}/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`,
    {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({}),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    logger.error(`Supabase Storage sign failed [${response.status}] bucket=${BUCKET} path=${objectPath} body=${text}`);
    throw new Error(`Supabase Storage sign failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { url: string };
  const signedUrl = `${env.supabaseUrl}${data.url}`;
  const publicUrl = `${env.supabaseUrl}/storage/v1/object/public/${BUCKET}/${objectPath}`;

  return { signedUrl, publicUrl };
}

async function listObjectNames(bucket: string, prefix: string): Promise<string[]> {
  const names: string[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(`${env.supabaseUrl}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({ prefix, limit: pageSize, offset }),
    });
    if (!response.ok) {
      throw new Error(`Supabase Storage list failed (${response.status}) bucket=${bucket}`);
    }
    const page = (await response.json()) as { name: string }[];
    names.push(...page.map((item) => `${prefix}/${item.name}`));
    if (page.length < pageSize) return names;
  }
}

/**
 * Deletes every object a user uploaded (profile photos, voice intro, chat media).
 * Objects are stored under `<userId>/...` in each bucket. Used by account deletion.
 */
export async function deleteUserStorage(userId: string): Promise<void> {
  if (!env.supabaseServiceRoleKey || !env.supabaseUrl) return;

  for (const bucket of [BUCKET, CHAT_BUCKET]) {
    const names = await listObjectNames(bucket, userId);
    for (let i = 0; i < names.length; i += 500) {
      const response = await fetch(`${env.supabaseUrl}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: serviceHeaders(),
        body: JSON.stringify({ prefixes: names.slice(i, i + 500) }),
      });
      if (!response.ok) {
        throw new Error(`Supabase Storage delete failed (${response.status}) bucket=${bucket}`);
      }
    }
  }
}
