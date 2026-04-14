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
  - Prisma schema for `users`, `profiles`, `messages`, `vibes`, `rooms`, `room_memberships`
  - Socket.io realtime messaging support
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
│   ├── auth
│   ├── profiles
│   ├── matching
│   ├── messaging
│   ├── rooms
│   └── payments
├── shared
│   ├── config
│   ├── db
│   ├── middleware
│   ├── realtime
│   └── utils
└── server.ts
```

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
