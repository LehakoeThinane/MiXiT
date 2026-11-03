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

## Store Release Setup (App Store + Google Play)

Code-side compliance is in place (store billing, account deletion, Sign in with Apple,
legal pages, moderation). These steps need your accounts/credentials:

### In-app purchases (RevenueCat)
1. Create products with exactly these IDs in **both** App Store Connect and the Play Console:
   - `mixit_premium_monthly` — auto-renewable subscription, 1 month
   - `mixit_vibe_boost` — consumable
2. Create a RevenueCat project, connect both stores, and add to `eas.json` build env:
   `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.
3. RevenueCat → Integrations → Webhooks: URL `https://<api>/payments/revenuecat/webhook`,
   Authorization header = the backend's `REVENUECAT_WEBHOOK_AUTH`.

PayFast (`/payments/subscribe`) is used by the **web** build only — Apple and Google
require their own billing for digital goods in mobile apps.

### Sign in with Apple
Enable the capability for `com.mixit.app`, create a *Sign in with Apple* key and set
`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (used to revoke tokens on account deletion).

### Store listing URLs (served by the API)
| Purpose | URL |
|---|---|
| Privacy policy | `https://<api>/legal/privacy` |
| Terms of use / EULA | `https://<api>/legal/terms` |
| Account deletion (Play Data safety) | `https://<api>/legal/delete-account` |
| Child safety standards (Play) | `https://<api>/legal/child-safety` |
| Support URL | `https://<api>/legal/support` |

Set `LEGAL_ENTITY_NAME` and `SUPPORT_EMAIL`. The legal text is a draft — have it reviewed (POPIA).

### Reviewer sign-in
Set `REVIEW_ACCOUNT_EMAIL` / `REVIEW_ACCOUNT_PASSWORD` and give them to Apple (App Review
Information) and Google (App access). Reviewers use "App reviewer? Sign in with email".

### Moderation (required for UGC apps — act on reports within 24h)
- Users can report/block from profiles, the chat ⋯ menu, and by long-pressing chat or room messages.
- Text is checked against `backend/src/shared/moderation/content-filter.ts` (hate slurs,
  child-exploitation terms, self-harm incitement).
- "Underage" reports automatically hide the reported user until a moderator reviews them.
  All other reports wait for human review.
- Set `MODERATION_WEBHOOK_URL` (Slack/Discord) to be pinged for every new report.
- Set `ADMIN_API_KEY` and work the queue with header `x-admin-key`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/reports?status=open` | Report queue (underage first) with evidence |
| GET | `/admin/users/:userId` | Profile, reports and room messages for a user |
| POST | `/admin/reports/:id/resolve` | `{ "action": "dismiss" \| "warn" \| "hold" \| "ban", "note"? }` |
| GET | `/admin/users?email=` | Look up a user (id, host status) by email |
| POST | `/admin/users/:userId/ban` · `/unban` · `/release` | Direct user actions |
| POST | `/admin/users/:userId/host` | `{ "isHost": true }` — lets the user schedule room sessions and meetups |

### Store console forms
App privacy labels / Data safety (data collected: email, name, photos, voice, messages,
precise location (optional), purchases, crash data — none used for tracking), content
rating questionnaires (user interaction, dating → expect 18+), and iPhone/Android screenshots.

## CI/CD

| Workflow | Trigger | What it does |
|---|---|---|
| `CI` (`.github/workflows/ci.yml`) | Push / PR to `main` or `dev` | **App:** Expo SDK version check, config validation, typecheck, lint. **Backend:** unit tests, migrations on a fresh Postgres, schema-vs-migrations drift check, build. **Docker:** builds the production image Railway deploys. |
| `EAS Build` (`.github/workflows/eas-build.yml`) | Manual (Actions tab) or tag `v*` | Builds iOS/Android on EAS (`preview`/`production`/`development`), optionally auto-submits production builds to TestFlight / Play internal testing. Needs the `EXPO_TOKEN` repo secret. |

**Backend deploys** are handled by Railway's GitHub integration (`backend/railway.toml`):
it builds `backend/Dockerfile`, runs `prisma migrate deploy` before each release and
health-checks `/health`. Point the Railway service at `main` so only reviewed code ships;
work happens on `dev` and is merged to `main` via pull request once CI is green.

**Release flow:** `dev` → PR → `main` (backend deploys) → tag `vX.Y.Z` → EAS production build.
