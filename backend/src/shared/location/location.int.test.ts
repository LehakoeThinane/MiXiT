import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../db/prisma.js';
import { authHeader, createTestUser, deleteTestUsers, startTestApp, type TestUser } from '../../test/integration.js';

let app: FastifyInstance;
let viewer: TestUser;
let near: TestUser; // 150 m from the viewer
let further: TestUser; // 900 m from the viewer

// Odd, recognisable coordinates so a leak is easy to spot in a response body.
const VIEWER = { lat: -26.248517, lng: 27.854113 };
const NEAR = { lat: VIEWER.lat + 150 / 111_000, lng: VIEWER.lng };
const FURTHER = { lat: VIEWER.lat + 900 / 111_000, lng: VIEWER.lng };

async function placeAt(user: TestUser, at: { lat: number; lng: number }) {
  // Written straight to the DB at full precision — like rows saved before the fix.
  await prisma.profile.update({ where: { userId: user.id }, data: { locationLat: at.lat, locationLng: at.lng } });
}

beforeAll(async () => {
  app = await startTestApp();
  [viewer, near, further] = await Promise.all([
    createTestUser({ displayName: 'Viewer' }),
    createTestUser({ displayName: 'Near' }),
    createTestUser({ displayName: 'Further' }),
  ]);
  await Promise.all([placeAt(viewer, VIEWER), placeAt(near, NEAR), placeAt(further, FURTHER)]);
  await prisma.vibe.createMany({
    data: [
      { fromUserId: near.id, toUserId: viewer.id },
      { fromUserId: further.id, toUserId: viewer.id },
    ],
  });
});

afterAll(async () => {
  await deleteTestUsers();
  await app.close();
});

type Card = { id: string; distance: string };

describe('distances shown to other users', () => {
  it('are the same for someone 150 m away and someone 900 m away (Discover)', async () => {
    const res = await app.inject({ method: 'GET', url: '/matching/candidates', headers: authHeader(viewer) });
    const cards = (res.json() as { candidates: Card[] }).candidates;
    const nearCard = cards.find((c) => c.id === near.id);
    const furtherCard = cards.find((c) => c.id === further.id);

    expect(nearCard?.distance).toBe('Less than 2 km away');
    expect(furtherCard?.distance).toBe(nearCard?.distance);
  });

  it('are coarse in the Vibes inbox too', async () => {
    const res = await app.inject({ method: 'GET', url: '/matching/vibes', headers: authHeader(viewer) });
    const cards = (res.json() as { vibes: Card[] }).vibes;
    expect(cards.map((c) => c.distance)).toEqual(['Less than 2 km away', 'Less than 2 km away']);
  });

  it("never include another user's coordinates", async () => {
    const leaks: string[] = [];
    for (const url of ['/matching/candidates', '/matching/vibes', `/profiles/${near.id}`, `/profiles/${further.id}`]) {
      const res = await app.inject({ method: 'GET', url, headers: authHeader(viewer) });
      for (const value of [NEAR.lat, FURTHER.lat, NEAR.lng].map((n) => String(n).slice(0, 7))) {
        if (res.body.includes(value)) leaks.push(`${url} contains ${value}`);
      }
      if (/location(Lat|Lng)/.test(res.body)) leaks.push(`${url} has a location field`);
    }
    expect(leaks).toEqual([]);
  });
});

describe('saving a profile', () => {
  it('stores coordinates snapped to the ~1 km grid, not the exact position', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/me',
      headers: authHeader(viewer),
      payload: {
        displayName: 'Viewer',
        age: 25,
        gender: 'other',
        interests: ['music'],
        locationLat: -26.248517,
        locationLng: 27.854113,
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = await prisma.profile.findUnique({ where: { userId: viewer.id } });
    expect(stored?.locationLat).toBe(-26.25);
    expect(stored?.locationLng).toBe(27.85);
  });
});
