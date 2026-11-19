# Production readiness tracker

Mirrors [`MIXIT_PRODUCTION_READINESS_PROMPT.md`](../MIXIT_PRODUCTION_READINESS_PROMPT.md). One row per item; update with every PR.

Status: ⬜ not started · 🟡 in progress · ✅ done · ⏸ blocked on owner decision (§11) · ➖ not needed (finding was wrong)

## Corrections to the brief (verified against `a653b99`)

| Brief item | What the code actually shows |
|---|---|
| Phase 0 — Metro/localhost quirk | Metro listens on `::` (dual-stack). `localhost`, `127.0.0.1` and `[::1]` all return 200 on the owner's machine. The failure seen was most likely while the dev server was being restarted. Nothing to fix. |
| 2.3 — "Docker/Railway path never runs migrations" | `backend/railway.toml` has `preDeployCommand = "pnpm exec prisma migrate deploy"`. Render runs it in the build command, as stated. |
| 2.3 — confirm `directUrl` | Already set: `directUrl = env("DIRECT_URL")`. |
| Phase 3 — "Add `@sentry/react-native` to the app" | Already a dependency, registered as an Expo plugin, and initialised in `app/_layout.tsx`. What remains is releases, source maps and PII scrubbing. |
| 4.2 — profile cache location | `shared/cache/profile-cache.ts`, not `redis.ts`. |
| 6 — `showPhone` "nothing reads it" | Only the owner's own profile screen reads it. `GET /profiles/:userId` never returns the phone number, so it has no effect on other users. The privacy-default question still stands. |
| 6 — content filter coverage | Already covers room messages, display names, bios, city, interests, intents and traits. |

## Missing from the brief (found during review)

| Finding | Where | Priority |
|---|---|---|
| Socket connect race: `message:send` and other handlers are registered **after** two awaited DB queries, so events sent right after connecting are silently dropped. Reproduced: 70 sends immediately after connect gave 0 deliveries. | `shared/realtime/socket.ts` `io.on('connection')` | P0 (add to 1.2) |
| No working sign-in on the **web** build: `@react-native-google-signin` (free tier) throws "Web support is only available to sponsors", and Apple sign-in is native-only. PayFast is web-only, so web purchases are unreachable. | `app/(tabs)/index.tsx` `handleGoogleSignIn` | P0 if web ships (§11) |
| Web bundle crashed with `import.meta` (zustand devtools ESM) and showed an endless spinner. | Fixed by `babel.config.js` (Phase 0 PR) | ✅ |
| Onboarding shows "Step 1 of 7", but step 2 doesn't exist and step 7 is a confirmation screen. There are 4 real input screens. | `app/(tabs)/index.tsx` | Phase 5 |
| Push token shared across accounts on one device: notifications leak to a signed-out or other user. | `profiles/routes.ts`, `auth/routes.ts` | P1 (fix written, see below) |
| PayFast "Premium" says "Renews monthly", but the web purchase is a one-off 30 days, and cancelling ends access immediately. | `payments/routes.ts` | P1 (copy) |

## Phase 0 — Sync and baseline

| Item | Status | PR | Notes |
|---|---|---|---|
| Local ↔ GitHub reconciled | 🟡 | | Local = `dev`/`main` (`a653b99`) + `babel.config.js` + session fixes (listed under Phase 1). This folder is now a git working copy tracking `origin`. |
| CI baseline | ✅ | | GitHub Actions green on `main` and `dev`. Locally: backend tsc ✅, vitest 50/50 ✅, migrate-diff ✅, app tsc ✅, lint 0 errors ✅, `expo install --check` ✅. Docker isn't installed locally, so the image build is CI-only. Windows note: vitest mocks fail if the shell cwd uses a lowercase `c:\`. |
| Seed script | ✅ | | `pnpm run db:seed` in `backend/`, re-runnable, refuses `NODE_ENV=production`. |
| Metro/localhost quirk | ➖ | | See corrections. |

## Phase 1 — P0 bugs

Session fixes written before the brief are in the working tree, **uncommitted**. Each will ship in its own PR with the integration tests the brief requires.

| Item | Status | PR | Notes |
|---|---|---|---|
| 1.1 DM thread oldest-50 | 🟡 | | Newest-50 ordering done. Still to do: `id` tiebreaker, cursor pagination plus "load earlier", read-marking scope, integration test. |
| 1.2 Socket rate limit / typing blocks | 🟡 | | Per-process 60/min limiter on `message:send` with unit tests. Still to do: Redis-backed budget shared with REST, typing block checks and throttling, payload validation, connect-race fix. |
| 1.3 `trustProxy` | 🟡 | | `trustProxy: true` set and verified (proxy IP recorded correctly). Still to do: per-host value, `keyGenerator` by user ID, test. |
| 1.4 Email leak | ⬜ | | Verified: `conversations` falls back to `peer.email`; chat route carries `name`, `initial` and `online` in the URL. |
| 1.5 Exact distances | ⬜ | | |
| 1.6 Token storage | 🟡 | | SecureStore adapter with AsyncStorage migration done (web keeps AsyncStorage). Still to do: TTL env vars, `expiresIn`, web model (§11 Q4). |
| 1.7 Held users DM | 🟡 | | Sender held gets 403. Held recipient gets 404 **pending §11 Q6**. Still to do: socket and REST integration tests. |
| 1.8 Conversation list | ⬜ | | |
| 1.9 Validation / 500s | ⬜ | | |
| 1.10 Graceful shutdown | ⬜ | | |
| 1.11 CORS | ⬜ | | |

## Phases 2–8

Not started. Blocked on owner decisions: hosting (§11 Q1) gates all of Phase 2, and instance count (Q2) gates 2.4 and 2.5.
