import { apiRequest } from '@/lib/api-client';

export type ReportReason = 'inappropriate_content' | 'harassment' | 'fake_profile' | 'spam' | 'underage' | 'other';

export const REPORT_REASONS: { reason: ReportReason; label: string }[] = [
  { reason: 'inappropriate_content', label: 'Inappropriate or sexual content' },
  { reason: 'harassment', label: 'Harassment, threats or hate' },
  { reason: 'underage', label: 'Appears to be under 18' },
  { reason: 'fake_profile', label: 'Fake profile or scam' },
  { reason: 'spam', label: 'Spam' },
  { reason: 'other', label: 'Something else' },
];

export type BlockedUser = {
  userId: string;
  name: string;
  blockedAt: string;
};

export async function blockUser(userId: string) {
  await apiRequest('/moderation/block', { method: 'POST', auth: true, body: { userId } });
}

export async function unblockUser(userId: string) {
  await apiRequest(`/moderation/block/${userId}`, { method: 'DELETE', auth: true });
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const response = await apiRequest<{ ok: boolean; blocked: BlockedUser[] }>('/moderation/blocked', { auth: true });
  return response.blocked;
}

export async function reportUser(
  userId: string,
  reason: ReportReason,
  options: { details?: string; messageId?: string; roomMessageId?: string } = {}
) {
  await apiRequest('/moderation/report', {
    method: 'POST',
    auth: true,
    body: {
      userId,
      reason,
      ...(options.details?.trim() ? { details: options.details.trim().slice(0, 1000) } : {}),
      ...(options.messageId ? { messageId: options.messageId } : {}),
      ...(options.roomMessageId ? { roomMessageId: options.roomMessageId } : {}),
    },
  });
}
