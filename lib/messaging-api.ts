import { apiRequest } from '@/lib/api-client';

export type ConversationSummary = {
  id: string;
  name: string;
  initial: string;
  preview: string;
  lastMessageAt: string;
  online: boolean;
};

type ConversationsResponse = {
  ok: boolean;
  conversations: ConversationSummary[];
};

export async function getConversations() {
  const response = await apiRequest<ConversationsResponse>('/messaging/conversations', {
    auth: true,
  });
  return response.conversations;
}
