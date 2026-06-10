import { ApiError, apiRequest } from '@/lib/api-client';

export type Profile = {
  id: string;
  userId: string;
  displayName: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  bio?: string | null;
  city?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  interests?: string[] | null;
  intents?: string[] | null;
  traits?: string[] | null;
  photos?: string[] | null;
  showPhone?: boolean;
  showLastSeen?: boolean;
  voiceIntroUrl?: string | null;
  voiceIntroDurationSec?: number | null;
  completedAt?: string | null;
  updatedAt: string;
  lastActive?: string | null;
  joinedAt?: string | null;
  roomsParticipated?: number | null;
};

type ProfileResponse = {
  ok: boolean;
  profile: Profile;
  stats?: {
    joinedAt?: string | null;
    roomsParticipated?: number;
  };
};

export async function getMyProfile() {
  try {
    const response = await apiRequest<ProfileResponse>('/profiles/me', { auth: true });
    return {
      ...response.profile,
      joinedAt: response.stats?.joinedAt ?? null,
      roomsParticipated: response.stats?.roomsParticipated ?? null,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

type PhotoUploadUrlResponse = {
  ok: boolean;
  signedUrl: string;
  publicUrl: string;
};

export async function requestPhotoUploadUrl(filename: string, mimeType: string): Promise<PhotoUploadUrlResponse> {
  return apiRequest<PhotoUploadUrlResponse>('/profiles/me/photo', {
    method: 'POST',
    auth: true,
    body: { filename, mimeType },
  });
}

export async function uploadPhotoToStorage(signedUrl: string, fileUri: string, mimeType: string): Promise<void> {
  const fileResponse = await fetch(fileUri);
  if (!fileResponse.ok) throw new Error('Could not read local file');

  const blob = await fileResponse.blob();

  const upload = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });

  if (!upload.ok) {
    const text = await upload.text().catch(() => '');
    throw new Error(`Storage upload failed: ${upload.status} ${text}`);
  }
}

export type PeerProfile = {
  userId: string;
  displayName: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  bio?: string | null;
  city?: string | null;
  interests?: string[] | null;
  intents?: string[] | null;
  traits?: string[] | null;
  photos?: string[] | null;
  voiceIntroUrl?: string | null;
  voiceIntroDurationSec?: number | null;
  lastActive?: string | null;
};

export async function getPeerProfile(userId: string): Promise<PeerProfile | null> {
  try {
    const response = await apiRequest<{ ok: boolean; profile: PeerProfile }>(`/profiles/${userId}`, { auth: true });
    return response.profile;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function upsertMyProfile(input: {
  displayName: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  bio?: string;
  city?: string;
  locationLat?: number;
  locationLng?: number;
  interests?: string[];
  intents?: string[];
  traits?: string[];
  photos?: string[];
  showPhone?: boolean;
  showLastSeen?: boolean;
  voiceIntroUrl?: string;
  voiceIntroDurationSec?: number;
}) {
  const response = await apiRequest<ProfileResponse>('/profiles/me', {
    method: 'PUT',
    auth: true,
    body: input,
    timeoutMs: 45_000,
  });
  return {
    ...response.profile,
    joinedAt: response.stats?.joinedAt ?? null,
    roomsParticipated: response.stats?.roomsParticipated ?? null,
  };
}
