import { apiRequest } from '@/lib/api-client';

export type ReportReason = 'inappropriate_content' | 'harassment' | 'fake_profile' | 'spam' | 'underage' | 'other';

export async function blockUser(userId: string) {
  await apiRequest('/moderation/block', { method: 'POST', auth: true, body: { userId } });
}

export async function unblockUser(userId: string) {
  await apiRequest(`/moderation/block/${userId}`, { method: 'DELETE', auth: true });
}

export async function reportUser(userId: string, reason: ReportReason, details?: string) {
  await apiRequest('/moderation/report', {
    method: 'POST',
    auth: true,
    body: { userId, reason, details },
  });
}
