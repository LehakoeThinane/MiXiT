import { apiRequest } from '@/lib/api-client';

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
  readAt: string | null;
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

export async function getConversations() {
  const response = await apiRequest<ConversationsResponse>('/messaging/conversations', { auth: true });
  return response.conversations;
}

export async function getThreadMessages(peerUserId: string) {
  const response = await apiRequest<ThreadResponse>(`/messaging/thread/${peerUserId}`, { auth: true });
  return response.messages;
}

export async function requestMediaUploadUrl(filename: string, mimeType: string) {
  return apiRequest<{ ok: boolean; signedUrl: string; publicUrl: string; mimeType: string }>(
    '/messaging/media-upload',
    { method: 'POST', auth: true, body: { filename, mimeType } }
  );
}

export async function uploadMediaToStorage(signedUrl: string, fileUri: string, mimeType: string): Promise<void> {
  // React Native's fetch returns status 0 for local file:// URIs — skip the ok check
  const fileResponse = await fetch(fileUri);
  const blob = await fileResponse.blob();

  const upload = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
  if (!upload.ok) throw new Error(`Media upload failed: ${upload.status}`);
}

export async function sendMessage(input: {
  recipientId: string;
  content?: string;
  type?: 'text' | 'voice' | 'image';
  mediaUrl?: string;
}) {
  const response = await apiRequest<SendMessageResponse>('/messaging/messages', {
    method: 'POST',
    auth: true,
    body: input,
  });
  return response.message;
}
