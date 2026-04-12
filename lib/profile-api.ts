import { ApiError, apiRequest } from '@/lib/api-client';

export type Profile = {
  id: string;
  userId: string;
  displayName: string;
  age: number;
  gender: 'male' | 'female' | 'non-binary';
  bio?: string | null;
  updatedAt: string;
  lastActive?: string | null;
};

type ProfileResponse = {
  ok: boolean;
  profile: Profile;
};

export async function getMyProfile() {
  try {
    const response = await apiRequest<ProfileResponse>('/profiles/me', { auth: true });
    return response.profile;
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
  gender: 'male' | 'female' | 'non-binary';
  bio?: string;
}) {
  const response = await apiRequest<ProfileResponse>('/profiles/me', {
    method: 'PUT',
    auth: true,
    body: input,
  });
  return response.profile;
}
