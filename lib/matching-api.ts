import { apiRequest } from '@/lib/api-client';

export type DiscoverCandidate = {
  id: string;
  name: string;
  age: number;
  distance: string;
  city: string;
  tags: string[];
  bio: string;
  initial: string;
  voiceDuration: string;
  online: boolean;
};

type CandidatesResponse = {
  ok: boolean;
  candidates: DiscoverCandidate[];
};

type VibesResponse = {
  ok: boolean;
  vibes: DiscoverCandidate[];
};

type SendVibeResponse = {
  ok: boolean;
  matched: boolean;
};

export async function getDiscoverCandidates() {
  const response = await apiRequest<CandidatesResponse>('/matching/candidates', {
    auth: true,
  });
  return response.candidates;
}

export async function getReceivedVibes() {
  const response = await apiRequest<VibesResponse>('/matching/vibes', {
    auth: true,
  });
  return response.vibes;
}

export async function sendVibe(toUserId: string) {
  const response = await apiRequest<SendVibeResponse>('/matching/vibe', {
    method: 'POST',
    auth: true,
    body: { toUserId },
  });
  return response;
}
