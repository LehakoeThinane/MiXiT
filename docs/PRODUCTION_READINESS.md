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
| 1.3 — "set `trustProxy` correctly" | Fly's rightmost `X-Forwarded-For` entry is the app's own IP, so no `trustProxy` value yields the real client safely. `Fly-Client-IP` is the right source (see 1.3). |
| 4.2 — profile cache location | `shared/cache/profile-cache.ts`, not `redis.ts`. |
| 6 — `showPhone` "nothing reads it" | Only the owner's own profile screen reads it. `GET /profiles/:userId` never returns the phone number, so it has no effect on other users. The privacy-default question still stands. |
| 6 — content filter coverage | Already covers room messages, display names, bios, city, interests, intents and traits. |

## Missing from the brief (found during review)

| Finding | Where | Priority |
|---|---|---|
| Socket connect race: `message:send` and other handlers are registered **after** two awaited DB queries, so events sent right after connecting are silently dropped. Reproduced: 70 sends immediately after connect gave 0 deliveries. | `shared/realtime/socket.ts` `io.on('connection')` | ✅ fixed in 1.2 |
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
| 1.1 DM thread oldest-50 | ✅ | | Newest page first with `(createdAt, id)` cursor (`before` + `beforeId`) and `hasMore`. Query validation (400, not 500). `id` tiebreaker on DM thread, conversation list and room messages (rooms also take an optional `beforeId`). Mark-as-read is scoped to the returned page; it stays on GET (moving it to a POST is deferred so the client changes stay small). App: "Load earlier messages" on scroll-to-top with the scroll position kept, refetches keep earlier pages, and socket/REST echoes are de-duplicated. New integration test layer (`pnpm run test:integration`, in CI): 10 tests, all failing on the old code. Verified in the web build against the 130-message seed thread. |
| 1.2 Socket rate limit / typing blocks | ✅ | | `shared/rate-limit/user-budget.ts`: per-user fixed-window budgets in Redis (atomic INCR+PEXPIRE script), with an in-memory fallback when Redis is down (not fail-open). DM budget of 60/min is spent inside `sendDirectMessage`, so REST and socket share it; REST returns 429 and socket emits `message:error`. The per-IP limit on `POST /messaging/messages` was replaced by this per-user one. Typing: 30 events per 10 s per user, dropped between blocked users (30 s cache, cleared on block/unblock). All socket payloads go through hand-written guards. **Connect race fixed:** handlers are registered before any await. Tests: 7 socket integration tests (all fail on the old code) plus 26 unit tests. |
| 1.3 `trustProxy` | ✅ | | **Not `trustProxy`:** on Fly the rightmost `X-Forwarded-For` entry is the app's own IP and earlier entries are client-controlled, so `true` is spoofable and `1` hop gives every user the same IP. Instead the API reads `Fly-Client-IP` (set by Fly's proxy) when `CLIENT_IP_HEADER` is configured (set in `fly.toml`). `keyGenerator`: `user:<id>` for verified access tokens (forged tokens fall back to IP), else `ip:<client ip>`. Session IPs use the same helper. **Also fixed:** (a) rate-limited requests returned **500, not 429**, because `@fastify/rate-limit` throws the builder's object and it lacked `statusCode`; (b) an unset `REDIS_URL` pointed the limiter at a non-existent localhost Redis, which with `skipOnError` disabled every limit. It now uses the in-memory store. 5 integration tests, all failing on the old code. |
| 1.4 Email leak | ✅ | | Two leaks: `GET /messaging/conversations` and `GET /moderation/blocked` fell back to the other user's **email** when they had no display name. Both now say "MiXiT user", and the conversation query only selects public fields. New `shared/users/public-identity.ts`. The thread response adds `peer` (`id`, `displayName`, `initial`, `online`), so the chat and profile screens take only the user ID in the URL; name and online status come from the API. Also: `GET /profiles/:id` honours **show last seen** (when off, `lastActive` is null and `online` is false), as does the thread `peer`. Audit test walks 20 user-facing GET endpoints (chats, threads, profiles, discover, vibes, stats, rooms, room messages, events, blocked list, referrals) with phones and emails set, and fails on any leak. 4 tests, all failing on the old code. Checked in the web build: tapping a chat gives `/chat/<id>` with the right header. **Still open:** Discover and Vibes cards compute `online` without honouring show last seen (Phase 5 item). |
| 1.5 Exact distances | ✅ | | `shared/location/privacy.ts`: coordinates are snapped to 2 decimal places (~1 km grid) **before they're stored**, and distances shown to others use bands ("Less than 2 km", "2–5 km", "5–10 km", "10–25 km", "25–50 km", "50+ km"), never metres or decimals. A data-only migration snaps existing rows (backward-compatible). The seed stores snapped coordinates too. Verified that no response returns another user's coordinates (guarded by a test; there was no existing leak). Tests: 14 unit tests (bands, snapping, an attacker walking their position in 50 m steps) and 4 integration tests (150 m and 900 m look the same in Discover and Vibes, no coordinates in responses, saved coordinates are snapped); 3 of the 4 fail on the old code (the 4th is the no-leak guard). Checked in the web build: a Discover card shows "10–25 km away". |
| 1.6 Token storage | ✅ | | **Storage:** on iOS/Android the session (tokens and user) is in the Keychain/Keystore via `expo-secure-store` (`lib/secure-storage.ts`). Sessions saved by older versions are moved out of AsyncStorage on first read. Web keeps AsyncStorage (mobile-only launch, §11 Q4). **TTLs:** `JWT_ACCESS_TTL` (default `15m`) and `JWT_REFRESH_TTL` (default `30d`) are now read and validated (bad values fail boot); refresh-session expiry follows them; `expiresIn` is real and also returned by `/auth/refresh`. **Found and fixed while shortening the TTL:** (a) concurrent 401s each refreshed with the same token, triggering reuse detection, which **logged the user out**; refresh is now single-flight. (b) The socket sent a fixed token, so reconnects after expiry were rejected and never retried; it now sends the current token and refreshes once on "Unauthorized". The socket is also no longer torn down on every token refresh. (c) Tokens had no `jti`, so **two sign-ins or refreshes in the same second produced identical refresh tokens and the second failed with a 500** (unique hash). App test setup added: `jest-expo`, `pnpm test`, in CI. Tests: 12 app tests and 3 backend integration tests (all fail on the old code except one sequential-refresh sanity check), plus 9 unit tests for duration parsing. Checked in the web build with an expired token: one refresh `POST`, one rotation, no reuse revocation, still signed in. |
| 1.7 Held users DM | 🟡 | | Sender held gets 403. Held recipient gets 404 **pending §11 Q6**. Still to do: socket and REST integration tests. |
| 1.8 Conversation list | ⬜ | | |
| 1.9 Validation / 500s | ⬜ | | |
| 1.10 Graceful shutdown | ⬜ | | |
| 1.11 CORS | ⬜ | | |

## Owner decisions (§11)

| # | Question | Decision (2026-11-19) |
|---|---|---|
| 1 | Hosting | **Fly.io `jnb`.** Remove Render and Railway configs in Phase 2. |
| 2 | Instances at launch | **1 instance + Redis.** |
| 4 | Web auth model | **Mobile-only launch.** Web is for local testing only, so web token hardening and web Google sign-in are out of scope for now. |
| 6 | Held recipients | **Reject** (sender gets "Recipient not found", same as banned). |
| 3, 5, 7–10 | Discover preferences, deleted-account messages, perf targets, retention, POPIA, monitoring budget | Open |

## Phases 2–8

Not started. Phase 2 now targets Fly.io `jnb` with 1 instance plus Redis.
