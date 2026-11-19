/**
 * Local/staging seed data. Re-runnable: deletes every `@seed.mixit.test` user
 * (cascading their data) and recreates them.
 *
 *   pnpm run db:seed
 *
 * Creates:
 *  - the main account (REVIEW_ACCOUNT_EMAIL, default demo@mixit.test), so you can
 *    sign in on web via "App reviewer? Sign in with email" and see everything below
 *  - 50 complete profiles across the launch area and other cities
 *  - a 130-message DM thread with the main account, plus 5 shorter conversations
 *  - the default rooms with members and messages
 *  - blocks in both directions, incoming vibes (2 mutual) and an active Vibe Boost
 */
import { PrismaClient } from '@prisma/client';

import { snapCoordinate } from '../src/shared/location/privacy.js';
import { BOOST_DURATION_MS, ensureSeedProducts } from '../src/modules/payments/routes.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed with NODE_ENV=production.');
  process.exit(1);
}

const prisma = new PrismaClient();
const SEED_DOMAIN = '@seed.mixit.test';
const MAIN_EMAIL = (process.env.REVIEW_ACCOUNT_EMAIL || 'demo@mixit.test').trim().toLowerCase();

// Deterministic PRNG so every seed run produces the same data.
let state = 20261119;
function rand() {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
}
const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
function pickSome<T>(items: readonly T[], count: number): T[] {
  return [...items].sort(() => rand() - 0.5).slice(0, count);
}

const CITIES = [
  { city: 'Soweto', lat: -26.2485, lng: 27.854, weight: 4 },
  { city: 'Johannesburg', lat: -26.2041, lng: 28.0473, weight: 4 },
  { city: 'Pretoria', lat: -25.7479, lng: 28.2293, weight: 1 },
  { city: 'Durban', lat: -29.8587, lng: 31.0218, weight: 1 },
  { city: 'Cape Town', lat: -33.9249, lng: 18.4241, weight: 1 },
] as const;
const WEIGHTED_CITIES = CITIES.flatMap((c) => Array.from({ length: c.weight }, () => c));

const FIRST_NAMES = [
  'Thando', 'Lerato', 'Sipho', 'Naledi', 'Kagiso', 'Zanele', 'Tshepo', 'Ayanda', 'Mpho', 'Nomsa',
  'Bongani', 'Palesa', 'Lwazi', 'Refilwe', 'Kamo', 'Dineo', 'Sizwe', 'Khanyi', 'Tumi', 'Busi',
];
const INTERESTS = [
  'amapiano', 'kwaito', 'jazz', 'hiking', 'braai', 'football', 'fashion', 'photography', 'coding',
  'cooking', 'gym', 'art', 'reading', 'travel', 'gaming', 'dancing', 'coffee', 'church', 'business',
];
const INTENTS = ['friendship', 'dating', 'networking', 'something serious'];
const LINES = [
  'Hey! How was your weekend?', 'Haha that is so true', 'Have you been to that new spot in Vilakazi Street?',
  'I am down for coffee this week', 'What music are you listening to lately?', 'Sharp sharp',
  'Lol no way', 'Let me check my schedule', 'That sounds lekker', 'Shame man, hope you feel better',
];

async function main() {
  const removed = await prisma.user.deleteMany({ where: { email: { endsWith: SEED_DOMAIN } } });
  await ensureSeedProducts();

  const mainUser = await prisma.user.upsert({
    where: { email: MAIN_EMAIL },
    update: { bannedAt: null, heldAt: null },
    create: { email: MAIN_EMAIL, termsAcceptedAt: new Date() },
  });
  const home = CITIES[0];
  const mainProfile = {
    displayName: 'Demo',
    age: 27,
    gender: 'female',
    bio: 'Main seed account — sign in with the reviewer credentials.',
    city: home.city,
    locationLat: home.lat,
    locationLng: home.lng,
    interests: ['amapiano', 'coffee', 'hiking'],
    intents: ['friendship', 'dating'],
    completedAt: new Date(),
    lastActive: new Date(),
  };
  await prisma.profile.upsert({
    where: { userId: mainUser.id },
    update: mainProfile,
    create: { userId: mainUser.id, ...mainProfile },
  });

  // ---- 50 complete profiles ----
  const users: { id: string; name: string }[] = [];
  for (let i = 0; i < 50; i++) {
    const place = pick(WEIGHTED_CITIES);
    const name = `${FIRST_NAMES[i % FIRST_NAMES.length]}${i >= FIRST_NAMES.length ? ` ${Math.floor(i / FIRST_NAMES.length) + 1}` : ''}`;
    const user = await prisma.user.create({
      data: {
        email: `user${String(i + 1).padStart(2, '0')}${SEED_DOMAIN}`,
        termsAcceptedAt: new Date(),
        profile: {
          create: {
            displayName: name,
            age: 18 + Math.floor(rand() * 22),
            gender: pick(['male', 'female', 'other'] as const),
            bio: `Into ${pickSome(INTERESTS, 2).join(' and ')}. ${place.city} born and raised.`,
            city: place.city,
            // ~0–5 km jitter around the city centre
            locationLat: snapCoordinate(place.lat + (rand() - 0.5) * 0.09),
            locationLng: snapCoordinate(place.lng + (rand() - 0.5) * 0.09),
            interests: pickSome(INTERESTS, 3 + Math.floor(rand() * 4)),
            intents: pickSome(INTENTS, 1 + Math.floor(rand() * 2)),
            completedAt: new Date(),
            lastActive: new Date(Date.now() - Math.floor(rand() * 3 * 24 * 60) * 60_000),
          },
        },
      },
    });
    users.push({ id: user.id, name });
  }

  // ---- DMs: one long thread (130) + five short ones ----
  const thread = (peerId: string, count: number, endMinutesAgo: number) =>
    Array.from({ length: count }, (_, i) => {
      const mine = i % 3 !== 0;
      const createdAt = new Date(Date.now() - (endMinutesAgo + (count - i)) * 60_000);
      const isLast = i === count - 1;
      return {
        senderId: mine ? peerId : mainUser.id,
        recipientId: mine ? mainUser.id : peerId,
        content: `${pick(LINES)} (#${i + 1})`,
        createdAt,
        // everything read except the newest incoming message
        readAt: isLast && mine ? null : createdAt,
      };
    });
  await prisma.message.createMany({ data: thread(users[0].id, 130, 1) });
  for (let c = 1; c <= 5; c++) await prisma.message.createMany({ data: thread(users[c].id, 4 + c, 200 * c) });

  // ---- Rooms ----
  const roomSeeds = [
    { slug: 'amapiano-lovers', name: 'Amapiano Lovers', emoji: '🎵', city: 'JHB', description: 'Music lovers and playlists' },
    { slug: 'young-hustlers', name: 'Young Hustlers', emoji: '💼', city: 'JHB', description: 'Business and side-hustle conversations' },
    { slug: 'soweto-cafe-scene', name: 'Soweto Cafe Scene', emoji: '☕', city: 'Soweto', description: 'Coffee spots and hangouts' },
    { slug: 'sunset-singles', name: 'Sunset Singles', emoji: '☀️', city: 'JHB', description: 'Meetups and relaxed chats' },
  ];
  for (const seed of roomSeeds) {
    const room = await prisma.room.upsert({ where: { slug: seed.slug }, update: {}, create: seed });
    const members = [mainUser.id, ...pickSome(users, 15).map((u) => u.id)];
    await prisma.roomMembership.createMany({
      data: members.map((userId) => ({ roomId: room.id, userId })),
      skipDuplicates: true,
    });
    await prisma.roomMessage.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        roomId: room.id,
        userId: pick(members.slice(1)),
        content: `${pick(LINES)} (room #${i + 1})`,
        createdAt: new Date(Date.now() - (30 - i) * 5 * 60_000),
      })),
    });
  }

  // ---- Blocks (both directions), vibes, active boost ----
  await prisma.block.createMany({
    data: [
      { blockerId: mainUser.id, blockedId: users[10].id },
      { blockerId: users[11].id, blockedId: mainUser.id },
    ],
  });
  const now = new Date();
  await prisma.vibe.createMany({
    data: users.slice(20, 28).map((u, i) => ({ fromUserId: u.id, toUserId: mainUser.id, matchedAt: i < 2 ? now : null })),
  });
  await prisma.vibe.createMany({
    data: users.slice(20, 22).map((u) => ({ fromUserId: mainUser.id, toUserId: u.id, matchedAt: now })),
  });
  const boost = await prisma.product.findUniqueOrThrow({ where: { slug: 'vibe-boost' } });
  await prisma.userPurchase.create({
    data: {
      userId: users[30].id,
      productId: boost.id,
      status: 'active',
      merchantReference: `seed:${users[30].id}`,
      amountInCents: 0,
      currency: boost.currency,
      expiresAt: new Date(Date.now() + BOOST_DURATION_MS),
    },
  });

  console.log(
    `Seeded (removed ${removed.count} old seed users): main account ${MAIN_EMAIL}, 50 profiles, ` +
      `130-message thread with ${users[0].name}, 5 short chats, ${roomSeeds.length} rooms, 2 blocks, ` +
      `8 incoming vibes (2 mutual), active boost on ${users[30].name}.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
