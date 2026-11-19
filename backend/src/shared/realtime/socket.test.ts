import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({ prisma: {} }));

const { parseId, parseMessageSend } = await import('./socket.js');

const uuid = '0b5c2a2e-5f7e-4e7f-9a39-0d1c7d6c1a11';

describe('parseMessageSend', () => {
  it('accepts a well-formed payload', () => {
    expect(parseMessageSend({ recipientId: uuid, content: 'hi', type: 'text' })).toEqual({
      recipientId: uuid,
      content: 'hi',
      type: 'text',
      mediaUrl: undefined,
    });
  });

  it.each([
    ['null', null],
    ['a string', 'hello'],
    ['an array', [uuid]],
    ['missing recipient', { content: 'hi' }],
    ['numeric recipient', { recipientId: 42, content: 'hi' }],
    ['over-long recipient', { recipientId: 'x'.repeat(37), content: 'hi' }],
    ['object content', { recipientId: uuid, content: { $gt: '' } }],
    ['content over 4000 chars', { recipientId: uuid, content: 'x'.repeat(4001) }],
    ['unknown type', { recipientId: uuid, content: 'hi', type: 'exe' }],
    ['numeric mediaUrl', { recipientId: uuid, type: 'image', mediaUrl: 1 }],
  ])('rejects %s', (_label, payload) => {
    expect(parseMessageSend(payload)).toBeNull();
  });
});

describe('parseId', () => {
  it('reads a bounded string field', () => {
    expect(parseId({ roomId: uuid }, 'roomId')).toBe(uuid);
  });

  it.each([[undefined], [null], [{}], [{ roomId: 7 }], [{ roomId: '' }], [{ roomId: 'x'.repeat(37) }]])(
    'rejects %j',
    (payload) => {
      expect(parseId(payload, 'roomId')).toBeNull();
    }
  );
});
