import { apiRequest } from '@/lib/api-client';
import { chatMessagesByProfileId } from '@/lib/mock-data';

const MOCK = process.env.EXPO_PUBLIC_MOCK_AUTH === 'true';

export type ConversationSummary = {
  id: string;
  name: string;
  initial: string;
  preview: string;
  lastMessageAt: string;
  online: boolean;
};

export type ThreadMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  content: string | null;
  type: 'text' | 'voice' | 'image' | string;
  mediaUrl: string | null;
  createdAt: string;
};

type ConversationsResponse = {
  ok: boolean;
  conversations: ConversationSummary[];
};

type ThreadResponse = {
  ok: boolean;
  messages: ThreadMessage[];
};

type SendMessageResponse = {
  ok: boolean;
  message: ThreadMessage;
};

const MOCK_CONVERSATIONS: ConversationSummary[] = [
  {
    id: 'thandi',
    name: 'Thandi',
    initial: 'T',
    preview: 'Haha I actually freelance 😄',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    online: true,
  },
  {
    id: 'lerato',
    name: 'Lerato',
    initial: 'L',
    preview: 'Hey! Any plans this weekend?',
    lastMessageAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    online: false,
  },
];

function mockThreadMessages(peerId: string): ThreadMessage[] {
  const messages = chatMessagesByProfileId[peerId] ?? [];
  return messages.map((m) => ({
    id: m.id,
    senderId: m.sender === 'me' ? 'mock-user-001' : peerId,
    recipientId: m.sender === 'me' ? peerId : 'mock-user-001',
    content: m.type === 'text' ? m.content : null,
    type: m.type,
    mediaUrl: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  }));
}

export async function getConversations(): Promise<ConversationSummary[]> {
  if (MOCK) return MOCK_CONVERSATIONS;
  const response = await apiRequest<ConversationsResponse>('/messaging/conversations', { auth: true });
  return response.conversations;
}

export async function getThreadMessages(peerUserId: string): Promise<ThreadMessage[]> {
  if (MOCK) return mockThreadMessages(peerUserId);
  const response = await apiRequest<ThreadResponse>(`/messaging/thread/${peerUserId}`, { auth: true });
  return response.messages;
}

export async function sendMessage(input: {
  recipientId: string;
  content?: string;
  type?: 'text' | 'voice' | 'image';
  mediaUrl?: string;
}): Promise<ThreadMessage> {
  if (MOCK) {
    return {
      id: `mock-msg-${Date.now()}`,
      senderId: 'mock-user-001',
      recipientId: input.recipientId,
      content: input.content ?? null,
      type: input.type ?? 'text',
      mediaUrl: input.mediaUrl ?? null,
      createdAt: new Date().toISOString(),
    };
  }
  const response = await apiRequest<SendMessageResponse>('/messaging/messages', {
    method: 'POST',
    auth: true,
    body: input,
  });
  return response.message;
}
