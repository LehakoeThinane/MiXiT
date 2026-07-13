import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = {
  block: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
};

vi.mock('../db/prisma.js', () => ({ prisma: mockPrisma }));

const { getBlockedUserIds, isBlockedPair } = await import('./blocks.js');

beforeEach(() => {
  mockPrisma.block.findMany.mockReset();
  mockPrisma.block.findFirst.mockReset();
});

describe('getBlockedUserIds', () => {
  it('returns an empty set when there are no blocks', async () => {
    mockPrisma.block.findMany.mockResolvedValue([]);
    const ids = await getBlockedUserIds('me');
    expect(ids.size).toBe(0);
  });

  it('includes users I blocked', async () => {
    mockPrisma.block.findMany.mockResolvedValue([{ blockerId: 'me', blockedId: 'them' }]);
    const ids = await getBlockedUserIds('me');
    expect(ids.has('them')).toBe(true);
  });

  it('includes users who blocked me (reverse direction)', async () => {
    mockPrisma.block.findMany.mockResolvedValue([{ blockerId: 'them', blockedId: 'me' }]);
    const ids = await getBlockedUserIds('me');
    expect(ids.has('them')).toBe(true);
  });

  it('merges both directions into one deduplicated set', async () => {
    mockPrisma.block.findMany.mockResolvedValue([
      { blockerId: 'me', blockedId: 'a' },
      { blockerId: 'b', blockedId: 'me' },
      { blockerId: 'me', blockedId: 'a' }, // duplicate, should collapse
    ]);
    const ids = await getBlockedUserIds('me');
    expect(ids).toEqual(new Set(['a', 'b']));
  });

  it('queries blocks in both directions for the given user', async () => {
    mockPrisma.block.findMany.mockResolvedValue([]);
    await getBlockedUserIds('me');
    expect(mockPrisma.block.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ blockerId: 'me' }, { blockedId: 'me' }] },
      })
    );
  });
});

describe('isBlockedPair', () => {
  it('returns true when a block exists in either direction', async () => {
    mockPrisma.block.findFirst.mockResolvedValue({ id: 'block-1' });
    expect(await isBlockedPair('a', 'b')).toBe(true);
  });

  it('returns false when no block exists', async () => {
    mockPrisma.block.findFirst.mockResolvedValue(null);
    expect(await isBlockedPair('a', 'b')).toBe(false);
  });

  it('checks both directions in the query', async () => {
    mockPrisma.block.findFirst.mockResolvedValue(null);
    await isBlockedPair('a', 'b');
    expect(mockPrisma.block.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { blockerId: 'a', blockedId: 'b' },
            { blockerId: 'b', blockedId: 'a' },
          ],
        },
      })
    );
  });
});
