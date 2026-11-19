import { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { publicIdentity } from '../users/public-identity.js';

/**
 * The chat list: one row per person, newest conversation first.
 *
 * Computed in SQL (latest message per peer via DISTINCT ON) instead of loading
 * the user's last 200 messages and grouping in JS — that version dropped every
 * older conversation as soon as one recent exchange filled the 200 (brief 1.8).
 * Blocked, banned and held peers are excluded in the query itself.
 *
 * Why a query and not a `conversations` table: it uses the existing message
 * indexes, needs no backfill or extra writes on every send, and is trivially
 * reversible. A table becomes worth it if a single user's message count gets
 * large enough for this scan to show up in EXPLAIN — tracked in brief 4.2.
 */

export type ConversationCursor = { before: Date; beforeId: string };

export type ConversationSummary = {
  id: string;
  name: string;
  initial: string;
  preview: string;
  lastMessageAt: string;
  online: boolean;
  unread: boolean;
  unreadCount: number;
  /** Id of the latest message — pass it with lastMessageAt as the next-page cursor. */
  lastMessageId: string;
};

type Row = {
  peer_id: string;
  message_id: string;
  type: string;
  content: string | null;
  created_at: Date;
  unread_count: number;
};

function formatPreview(type: string, content: string | null) {
  if (type === 'voice') return 'Voice note';
  if (type === 'image') return 'Photo';
  if (content && content.trim().length > 0) return content.trim();
  return 'Start the conversation';
}

export async function listConversations(
  userId: string,
  options: { limit: number; cursor?: ConversationCursor }
): Promise<{ conversations: ConversationSummary[]; hasMore: boolean }> {
  const { limit, cursor } = options;
  // created_at is `timestamp without time zone` holding UTC. Passing a JS Date
  // would arrive as timestamptz and be converted using the DB session's time zone
  // (e.g. Africa/Johannesburg = 2 h off), so send the UTC wall-clock time as text.
  const cursorFilter = cursor
    ? Prisma.sql`AND (l.created_at, l.message_id) < (${cursor.before.toISOString().replace('Z', '')}::timestamp, ${cursor.beforeId})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Row[]>`
    WITH latest AS (
      SELECT DISTINCT ON (peer_id)
        peer_id, id AS message_id, type, content, created_at
      FROM (
        SELECT m.*, CASE WHEN m.sender_id = ${userId} THEN m.recipient_id ELSE m.sender_id END AS peer_id
        FROM messages m
        WHERE m.sender_id = ${userId} OR m.recipient_id = ${userId}
      ) mine
      ORDER BY peer_id, created_at DESC, id DESC
    )
    SELECT
      l.peer_id, l.message_id, l.type, l.content, l.created_at,
      (
        SELECT COUNT(*)::int FROM messages u
        WHERE u.recipient_id = ${userId} AND u.sender_id = l.peer_id AND u.read_at IS NULL
      ) AS unread_count
    FROM latest l
    JOIN users p ON p.id = l.peer_id
    WHERE p.banned_at IS NULL
      AND p.held_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ${userId} AND b.blocked_id = l.peer_id)
           OR (b.blocker_id = l.peer_id AND b.blocked_id = ${userId})
      )
      ${cursorFilter}
    ORDER BY l.created_at DESC, l.message_id DESC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const profiles = await prisma.profile.findMany({
    where: { userId: { in: page.map((row) => row.peer_id) } },
    select: { userId: true, displayName: true, lastActive: true, showLastSeen: true },
  });
  const profileByUser = new Map(profiles.map((profile) => [profile.userId, profile]));

  return {
    hasMore,
    conversations: page.map((row) => {
      const identity = publicIdentity(row.peer_id, profileByUser.get(row.peer_id));
      return {
        id: row.peer_id,
        name: identity.displayName,
        initial: identity.initial,
        preview: formatPreview(row.type, row.content),
        lastMessageAt: row.created_at.toISOString(),
        online: identity.online,
        unread: row.unread_count > 0,
        unreadCount: row.unread_count,
        lastMessageId: row.message_id,
      };
    }),
  };
}
