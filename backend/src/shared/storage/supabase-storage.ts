import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const BUCKET = 'profile-photos';
const CHAT_BUCKET = 'chat-media';
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB

function serviceHeaders(): Record<string, string> {
  return {
    apikey: env.supabaseServiceRoleKey,
    Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

export async function ensureStorageBucket(): Promise<void> {
  if (!env.supabaseServiceRoleKey) {
    logger.warn('SUPABASE_SERVICE_ROLE_KEY not set — photo uploads disabled');
    return;
  }

  const check = await fetch(`${env.supabaseUrl}/storage/v1/bucket/${BUCKET}`, {
    headers: serviceHeaders(),
  });

  if (check.ok) return;

  const create = await fetch(`${env.supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      fileSizeLimit: MAX_FILE_BYTES,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    }),
  });

  if (!create.ok) {
    const text = await create.text();
    throw new Error(`Failed to create storage bucket: ${text}`);
  }

  logger.info('Storage bucket created', { bucket: BUCKET });
}

export async function ensureChatMediaBucket(): Promise<void> {
  if (!env.supabaseServiceRoleKey) return;

  const check = await fetch(`${env.supabaseUrl}/storage/v1/bucket/${CHAT_BUCKET}`, {
    headers: serviceHeaders(),
  });
  if (check.ok) return;

  const create = await fetch(`${env.supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({
      id: CHAT_BUCKET,
      name: CHAT_BUCKET,
      public: true,
      fileSizeLimit: MAX_AUDIO_BYTES,
      allowedMimeTypes: ['audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'image/jpeg', 'image/png', 'image/webp'],
    }),
  });

  if (!create.ok) {
    const text = await create.text();
    throw new Error(`Failed to create chat-media bucket: ${text}`);
  }
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
    { method: 'POST', headers: serviceHeaders() }
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
    }
  );

  if (!response.ok) {
    const text = await response.text();
    logger.error({ status: response.status, body: text, bucket: BUCKET, objectPath }, 'Supabase Storage sign failed');
    throw new Error(`Supabase Storage sign failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { url: string };
  const signedUrl = `${env.supabaseUrl}${data.url}`;
  const publicUrl = `${env.supabaseUrl}/storage/v1/object/public/${BUCKET}/${objectPath}`;

  return { signedUrl, publicUrl };
}
