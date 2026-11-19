import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../cache/redis.js', () => ({ redis: { status: 'wait', eval: vi.fn() } }));

const { consumeUserBudget, resetInMemoryBudgets } = await import('./user-budget.js');

const budget = { name: 'test', limit: 3, windowMs: 60_000 };

/** Fake Redis that runs the INCR+PEXPIRE script against a Map. */
function fakeStore(status = 'ready') {
  const counts = new Map<string, number>();
  return {
    status,
    counts,
    eval: vi.fn(async (_script: string, _numKeys: number, key: string | number) => {
      const next = (counts.get(String(key)) ?? 0) + 1;
      counts.set(String(key), next);
      return next;
    }),
  };
}

beforeEach(() => resetInMemoryBudgets());

describe('consumeUserBudget', () => {
  it('allows up to the limit per window, then refuses', async () => {
    const store = fakeStore();
    const now = 1_000_000_000;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await consumeUserBudget(budget, 'u1', { store, now }));
    expect(results).toEqual([true, true, true, false, false]);
  });

  it('keeps users separate', async () => {
    const store = fakeStore();
    const now = 1_000_000_000;
    for (let i = 0; i < 3; i++) await consumeUserBudget(budget, 'u1', { store, now });
    expect(await consumeUserBudget(budget, 'u1', { store, now })).toBe(false);
    expect(await consumeUserBudget(budget, 'u2', { store, now })).toBe(true);
  });

  it('starts a fresh allowance in the next window', async () => {
    const store = fakeStore();
    const now = 1_000_000_000 - (1_000_000_000 % 60_000);
    for (let i = 0; i < 3; i++) await consumeUserBudget(budget, 'u1', { store, now });
    expect(await consumeUserBudget(budget, 'u1', { store, now: now + 59_999 })).toBe(false);
    expect(await consumeUserBudget(budget, 'u1', { store, now: now + 60_000 })).toBe(true);
  });

  it('uses the in-memory window (not fail-open) when Redis is not ready', async () => {
    const store = fakeStore('end');
    const now = 1_000_000_000;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await consumeUserBudget(budget, 'u1', { store, now }));
    expect(results).toEqual([true, true, true, false, false]);
    expect(store.eval).not.toHaveBeenCalled();
  });

  it('falls back to the in-memory window when a Redis call fails', async () => {
    const store = fakeStore();
    store.eval.mockRejectedValue(new Error('connection reset'));
    const now = 1_000_000_000;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeUserBudget(budget, 'u1', { store, now }));
    expect(results).toEqual([true, true, true, false]);
  });
});
