import { ApiError, apiRequest } from '@/lib/api-client';

const MOCK = process.env.EXPO_PUBLIC_MOCK_AUTH === 'true';

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

// In-memory store so mock profile persists across refetches within a session.
let _mockProfile: (Profile & { joinedAt: string | null; roomsParticipated: number | null }) | null = null;

export async function getMyProfile() {
  if (MOCK) return _mockProfile;
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
  if (MOCK) {
    _mockProfile = {
      id: 'mock-profile-001',
      userId: 'mock-user-001',
      displayName: input.displayName,
      age: input.age,
      gender: input.gender,
      bio: input.bio ?? null,
      city: input.city ?? null,
      locationLat: input.locationLat ?? null,
      locationLng: input.locationLng ?? null,
      interests: input.interests ?? null,
      intents: input.intents ?? null,
      traits: input.traits ?? null,
      photos: input.photos ?? null,
      showPhone: input.showPhone ?? true,
      showLastSeen: input.showLastSeen ?? true,
      voiceIntroUrl: input.voiceIntroUrl ?? null,
      voiceIntroDurationSec: input.voiceIntroDurationSec ?? null,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      joinedAt: new Date().toISOString(),
      roomsParticipated: 0,
    };
    return _mockProfile;
  }
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
