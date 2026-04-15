# MiXiT

MiXiT is an Expo mobile app plus a modular Fastify backend scaffold.

## Current Status

Implemented:

- Expo app scaffold in this root folder
- React Query global provider with offline-first defaults
- Core packages installed: `@tanstack/react-query`, `zustand`, `expo-image`, `expo-av`, `@shopify/flash-list`
- Backend scaffold in `backend/`:
  - Fastify app and health route
  - Module boundaries: `auth`, `profiles`, `matching`, `messaging`, `rooms`, `payments`
  - Prisma schema for `users`, `profiles`, `messages`, `vibes`, `rooms`, `room_memberships`, `products`, `user_purchases`
  - **Auth**: Phone OTP via SMSPortal with JWT access/refresh rotation
  - **Matching**: Scored candidate discovery (interest overlap, intent alignment, recency, profile completeness), Haversine distance, vibe/retract, matching stats
  - **Messaging**: Socket.io realtime messaging with read receipts
  - **Rooms**: Group rooms with join/leave persistence
  - **Payments**: Product catalog (MiXiT Premium, Vibe Boost, Super Vibe), subscribe/purchase, auto-expiry, cancellation
  - Room join/leave persistence

## Database Setup (Local)

```bash
cd backend
copy .env.example .env
corepack pnpm install
corepack pnpm run prisma:generate
corepack pnpm run prisma:migrate
```

## Run Mobile

```bash
corepack pnpm run android
corepack pnpm run ios
corepack pnpm run web
```

## Run Backend

```bash
cd backend
corepack pnpm run dev
```

Health check:

```bash
GET http://localhost:4000/health
```

## Backend Structure

```text
backend/src
├── modules
│   ├── auth          — OTP phone auth + JWT token rotation
│   ├── profiles      — CRUD with privacy, intents, traits, photos
│   ├── matching      — Scored discover, vibe/retract, stats
│   ├── messaging     — Conversations, threads, realtime via Socket.io
│   ├── rooms         — Group rooms with join/leave
│   └── payments      — Products, subscriptions, purchases
├── shared
│   ├── cache         — Redis client
│   ├── config        — Environment variables
│   ├── db            — Prisma client
│   ├── middleware     — Request ID, auth guard
│   ├── realtime      — Socket.io server
│   └── utils         — Logger
└── server.ts
```

## API Endpoints

| Module | Method | Path | Description |
|--------|--------|------|-------------|
| Auth | POST | `/auth/request-otp` | Request OTP via SMS |
| Auth | POST | `/auth/verify-otp` | Verify OTP, get tokens |
| Auth | POST | `/auth/refresh` | Rotate refresh token |
| Auth | POST | `/auth/logout` | Revoke refresh session |
| Auth | GET | `/auth/me` | Get current user |
| Profiles | GET | `/profiles/me` | Get my profile |
| Profiles | PUT | `/profiles/me` | Create/update profile |
| Matching | GET | `/matching/candidates` | Scored discover feed |
| Matching | POST | `/matching/vibe` | Send a vibe |
| Matching | DELETE | `/matching/vibe/:userId` | Retract a vibe |
| Matching | GET | `/matching/vibes` | Received vibes |
| Matching | GET | `/matching/stats` | Match statistics |
| Messaging | GET | `/messaging/conversations` | Chat list |
| Messaging | GET | `/messaging/thread/:peerUserId` | Message thread |
| Messaging | POST | `/messaging/messages` | Send message |
| Rooms | GET | `/rooms/list` | List rooms |
| Rooms | POST | `/rooms/join/:roomId` | Join a room |
| Rooms | DELETE | `/rooms/join/:roomId` | Leave a room |
| Payments | GET | `/payments/products` | List products |
| Payments | POST | `/payments/subscribe` | Purchase a product |
| Payments | GET | `/payments/me` | My purchases |
| Payments | DELETE | `/payments/me/:purchaseId` | Cancel purchase |

## Render One-Click Deploy

This repo includes a Blueprint file at [`render.yaml`](./render.yaml) that creates:

- `mixit-api` (Node web service from `backend/`)
- `mixit-db` (Postgres)
- `mixit-redis` (Render Key Value)

### Deploy steps

1. Push code to GitHub.
2. In Render: **New +** -> **Blueprint**.
3. Select this repo and keep `render.yaml`.
4. Render provisions infra and deploys.
5. Use the generated API URL in mobile builds as:
   - `EXPO_PUBLIC_API_URL=https://<your-api>.onrender.com`

`preDeployCommand` runs `prisma migrate deploy` automatically on each deployment.
