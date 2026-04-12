# MiXiT

MiXiT is an Expo mobile app plus a modular Fastify backend scaffold.

## Week 1 Status

Implemented:

- Expo app scaffold in this root folder
- React Query global provider with offline-first defaults
- Core packages installed: `@tanstack/react-query`, `zustand`, `expo-image`, `expo-av`, `@shopify/flash-list`
- Backend scaffold in `backend/`:
  - Fastify app and health route
  - Module boundaries: `auth`, `profiles`, `matching`, `messaging`, `payments`
  - Prisma schema baseline for `users`, `profiles`, `messages`

## Run Mobile

```bash
corepack pnpm run android
corepack pnpm run ios
corepack pnpm run web
```

## Run Backend

```bash
cd backend
copy .env.example .env
corepack pnpm install
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
│   └── payments
├── shared
│   ├── config
│   ├── middleware
│   └── utils
└── server.ts
```
