import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const BUCKET = 'profile-photos';
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

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
    `${env.supabaseUrl}/storage/v1/object/sign/upload/${BUCKET}/${objectPath}`,
    {
      method: 'POST',
      headers: serviceHeaders(),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase Storage sign failed: ${text}`);
  }

  const data = (await response.json()) as { url: string };
  const signedUrl = `${env.supabaseUrl}${data.url}`;
  const publicUrl = `${env.supabaseUrl}/storage/v1/object/public/${BUCKET}/${objectPath}`;

  return { signedUrl, publicUrl };
}
