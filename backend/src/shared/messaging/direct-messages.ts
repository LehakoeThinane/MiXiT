import type { Message } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { isBlockedPair } from '../moderation/blocks.js';
import { checkText, FILTERED_MESSAGE } from '../moderation/content-filter.js';
import { sendPushNotification } from '../push/expo-push.js';
import { getSocketServer } from '../realtime/socket.js';
import { isOwnChatMediaUrl, signChatMediaUrl, signChatMediaUrls } from '../storage/supabase-storage.js';

export type ClientMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  content: string | null;
  type: string;
  mediaUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

function serialize(message: Message, mediaUrl: string | null): ClientMessage {
  return {
    id: message.id,
    senderId: message.senderId,
    recipientId: message.recipientId,
    content: message.content,
    type: message.type,
    mediaUrl,
    readAt: message.readAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}

/** Serializes messages for a client, swapping private media URLs for signed ones. */
export async function toClientMessages(messages: Message[]): Promise<ClientMessage[]> {
  const signed = await signChatMediaUrls(messages.map((m) => m.mediaUrl));
  return messages.map((m) => serialize(m, m.mediaUrl ? signed.get(m.mediaUrl) ?? m.mediaUrl : null));
}

export type SendDirectMessageInput = {
  recipientId: string;
  content?: string | null;
  type?: string;
  mediaUrl?: string | null;
};

export type SendDirectMessageResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; status: number; message: string };

/**
 * Single path for creating a direct message (REST and Socket.IO), so every
 * safety check — blocks, holds/bans, content filter, media ownership — applies
 * to both.
 */
export async function sendDirectMessage(
  senderId: string,
  input: SendDirectMessageInput
): Promise<SendDirectMessageResult> {
  const { recipientId } = input;
  const type = input.type ?? 'text';
  const content = input.content?.trim() ? input.content : null;
  const mediaUrl = input.mediaUrl || null;

  if (!recipientId || recipientId === senderId) return { ok: false, status: 400, message: 'Invalid recipient' };
  if (!['text', 'voice', 'image'].includes(type)) return { ok: false, status: 400, message: 'Invalid message type' };
  if (!content && !mediaUrl) return { ok: false, status: 400, message: 'Message content is required' };
  if (content && content.length > 4000) return { ok: false, status: 400, message: 'Message is too long' };
  if (type !== 'text' && !mediaUrl) return { ok: false, status: 400, message: 'Media is required' };
  if (mediaUrl && !isOwnChatMediaUrl(mediaUrl, senderId)) {
    return { ok: false, status: 400, message: 'Invalid media' };
  }
  // Voice notes carry their duration in `content`; only filter real text.
  if (type === 'text' && !checkText(content).ok) return { ok: false, status: 422, message: FILTERED_MESSAGE };

  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { id: true, bannedAt: true, heldAt: true },
  });
  if (!recipient || recipient.bannedAt) return { ok: false, status: 404, message: 'Recipient not found' };
  if (await isBlockedPair(senderId, recipientId)) {
    return { ok: false, status: 403, message: 'Cannot message this user' };
  }

  const created = await prisma.message.create({
    data: { senderId, recipientId, content, mediaUrl, type },
  });

  const payload = serialize(created, await signChatMediaUrl(created.mediaUrl));

  const io = getSocketServer();
  io?.to(`user:${recipientId}`).emit('message:received', payload);
  io?.to(`user:${senderId}`).emit('message:sent', payload);

  const [senderProfile, recipientProfile] = await Promise.all([
    prisma.profile.findUnique({ where: { userId: senderId }, select: { displayName: true } }),
    prisma.profile.findUnique({ where: { userId: recipientId }, select: { pushToken: true } }),
  ]);
  const preview =
    type === 'voice' ? 'Sent a voice note' : type === 'image' ? 'Sent a photo' : (content ?? '').slice(0, 100);
  sendPushNotification(recipientProfile?.pushToken, senderProfile?.displayName ?? 'Someone', preview, {
    type: 'message',
    senderId,
  }).catch(() => {});

  return { ok: true, message: payload };
}
