import { ApiError, apiRequest } from '@/lib/api-client';

export type Profile = {
  id: string;
  userId: string;
  displayName: string;
  age: number;
  gender: 'male' | 'female' | 'homesexual';
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
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function upsertMyProfile(input: {
  displayName: string;
  age: number;
  gender: 'male' | 'female' | 'homesexual';
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
    timeoutMs: 45_000, // profile save may carry large base64 photos
  });
  return {
    ...response.profile,
    joinedAt: response.stats?.joinedAt ?? null,
    roomsParticipated: response.stats?.roomsParticipated ?? null,
  };
}
