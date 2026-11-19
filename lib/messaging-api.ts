import { apiRequest } from '@/lib/api-client';

export type ConversationSummary = {
  id: string;
  name: string;
  initial: string;
  preview: string;
  lastMessageAt: string;
  online: boolean;
  unread: boolean;
  unreadCount?: number;
  lastMessageId?: string;
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
  hasMore?: boolean;
};

type ThreadResponse = {
  ok: boolean;
  messages: ThreadMessage[];
  hasMore: boolean;
  peer?: PeerIdentity;
};

/** Public identity of the person a chat is with (never email/phone). */
export type PeerIdentity = { id: string; displayName: string; initial: string; online: boolean };

export type ThreadPage = { messages: ThreadMessage[]; hasMore: boolean; peer: PeerIdentity | null };

type SendMessageResponse = {
  ok: boolean;
  message: ThreadMessage;
};

/**
 * The chat list (newest first). Fetches the server's maximum page of 100 people,
 * which covers almost everyone; a "load more" for longer lists is a follow-up
 * (the API already supports it via before/beforeId).
 */
export async function getConversations() {
  const response = await apiRequest<ConversationsResponse>('/messaging/conversations?limit=100', { auth: true });
  return response.conversations;
}

/**
 * One page of a DM thread, oldest-first. With no cursor this is the newest page;
 * pass the oldest message you already have to load the page before it.
 */
export async function getThreadPage(peerUserId: string, olderThan?: Pick<ThreadMessage, 'id' | 'createdAt'>): Promise<ThreadPage> {
  const query = olderThan
    ? `?before=${encodeURIComponent(olderThan.createdAt)}&beforeId=${encodeURIComponent(olderThan.id)}`
    : '';
  const response = await apiRequest<ThreadResponse>(`/messaging/thread/${peerUserId}${query}`, { auth: true });
  return { messages: response.messages, hasMore: response.hasMore ?? false, peer: response.peer ?? null };
}

/** Chronological order with a deterministic tiebreaker — matches the server. */
export function compareMessages(a: Pick<ThreadMessage, 'id' | 'createdAt'>, b: Pick<ThreadMessage, 'id' | 'createdAt'>) {
  return a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1;
}

/** Merges message lists, dropping duplicates (socket echo vs REST response) and keeping order. */
export function mergeMessages(...lists: ThreadMessage[][]): ThreadMessage[] {
  const byId = new Map<string, ThreadMessage>();
  for (const list of lists) for (const message of list) byId.set(message.id, { ...byId.get(message.id), ...message });
  return [...byId.values()].sort(compareMessages);
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
