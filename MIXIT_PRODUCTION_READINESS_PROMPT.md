# MiXiT — Production Readiness Brief for Claude Code

You are taking over **MiXiT** to get it ready for a production launch. Treat this as a senior-engineer engagement: verify, fix, test, and document. Do not rewrite the app. Make small, reviewable changes that keep it working at every step.

This brief comes from a review of commit `a653b99` on `main` (GitHub: `LehakoeThinane/MiXiT`) plus a hands-on walkthrough of the running web build. **Line references are approximate. Verify every finding against the current code before changing anything.** If a finding turns out to be wrong or already fixed, say so and move on.

---

## 0. Context

**What MiXiT is:** a social / dating app for South Africa (Soweto/JHB launch area). Features: Discover (scored candidate profiles), Vibes (likes), 1:1 Chats (text, voice notes, photos), Rooms (group chat plus room events and RSVPs), Premium / Boost / Super Vibe purchases (PayFast on web, RevenueCat for store purchases), referrals, reporting, blocking and moderation.

**Stack**
- **App (repo root):** Expo SDK 54 / React Native / expo-router, React Query, Zustand, pnpm. Builds for iOS, Android and web.
- **API (`backend/`):** Fastify 5, Prisma 6 on Postgres (Supabase in prod), Socket.IO with an optional Redis adapter, ioredis, Sentry, `@fastify/rate-limit`, Helmet, Supabase Storage for media.
- **CI:** `.github/workflows/ci.yml` runs typecheck, lint and `expo install --check` for the app; vitest, `prisma migrate deploy`, the migrate-diff check, the build and a Docker build for the backend.
- **Deploy configs:** currently **three** of them: `fly.toml` (region `jnb`), `render.yaml` (Frankfurt, free plan) and `backend/railway.toml`.

**Local setup on the owner's machine (Windows):** code at `C:\Users\Lehakoe\Documents\MiXiT-main`. App on `:8081`, API on `:4000`, throwaway Postgres on `:5433`. Sign in on web with the reviewer email/password from your local backend `.env` (`REVIEW_ACCOUNT_*`). Google sign-in does not work on web locally.

> ⚠️ **The local copy is ahead of GitHub.** It has at least an uncommitted `babel.config.js` fix. Before anything else, reconcile local and remote (see Phase 0).

---

## 1. Ground rules

1. **Verify before you fix.** For each item, reproduce it or point to the exact code, then fix it.
2. **One concern per PR.** Branch from `dev`. Each phase below is one or more PRs into `dev`. Never push to `main` directly.
3. **Every bug fix ships with a test that fails before the fix and passes after.** Backend: vitest plus `fastify.inject()` against a real Postgres (CI already runs a Postgres service). Sockets: `socket.io-client` against an in-process server.
4. **Migrations must be backward-compatible** (expand → migrate data → contract), so a rolling deploy never breaks the running version. Never edit an existing migration.
5. **Keep CI green.** Add CI steps as you add test layers.
6. **No secrets in git.** No real keys, passwords or tokens in code, tests, docs or commit messages. Use `.env.example` with placeholders.
7. **Don't make product or legal decisions yourself.** Anything listed in §11, *Decisions needed from the owner*, gets a question, not a guess. Build the mechanism behind a config flag where possible.
8. **Don't break what's already good** (see §10).
9. **Track progress** in a `docs/PRODUCTION_READINESS.md` checklist that mirrors this brief, with status, PR link and notes per item. Update it with every PR.

---

## Phase 0 — Sync and baseline

- [ ] Get the owner's local changes (including `babel.config.js`) committed and pushed, so GitHub is the source of truth. Confirm `git status` is clean on the owner's machine afterwards.
- [ ] Run the full CI locally and in GitHub Actions. Record any pre-existing failures before changing code.
- [ ] Add a seed script (`backend/prisma/seed.ts`) that creates realistic local data: about 50 complete profiles across launch cities, a chat thread with **more than 120 messages**, rooms, blocks and an active Boost. Several items below need this to reproduce.
- [ ] **Metro/localhost quirk:** on the owner's machine `http://localhost:8081` fails in Chrome but `http://127.0.0.1:8081` works (Metro is likely bound to IPv4 only while Chrome tries `::1` first). Fix this in the dev scripts (e.g. bind Metro explicitly) or document it in the README.

---

## Phase 1 — Correctness and security bugs (P0, launch blockers)

### 1.1 DM threads load the *oldest* 50 messages
- **Where:** `backend/src/modules/messaging/routes.ts`, `GET /messaging/thread/:peerUserId` uses `orderBy: { createdAt: 'asc' }, take: limit` (default 50). The client (`lib/messaging-api.ts`, `app/chat/[id].tsx`) never sends `limit` and never paginates.
- **Impact:** after a conversation passes 50 messages, opening it shows the first 50 and the newest messages are missing. This hits the most active users first.
- **Fix:** query `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]` with `take`, then reverse. Add cursor pagination (`?before=<createdAt>&beforeId=<id>`, or an opaque cursor) and "load earlier" on scroll-to-top in the chat screen. Follow the pattern `rooms/routes.ts` already uses for room messages.
- **Mark-as-read:** this GET currently marks every unread message in the page as read. Keep that, but scope it to unread messages *in the returned page*. Consider moving it to an explicit `POST /messaging/thread/:id/read` so a GET has no side effects.
- **Ordering determinism:** add `id` as a tiebreaker everywhere messages are ordered (DMs, rooms, conversation list). Two messages with the same `createdAt` must not swap places between loads.
- **Acceptance:** the seeded 120-message thread opens on the latest messages, scrolling up loads older pages with no gaps or duplicates, and a test covers both.

### 1.2 Socket.IO message sends bypass rate limiting
- **Where:** `backend/src/shared/realtime/socket.ts`. `socket.on('message:send')` calls `sendDirectMessage` with **no rate limit**. Only the REST route has `max: 60 / minute`. `typing:start` / `typing:stop` also have no limit and **no block check**, so a blocked user can still trigger "typing…" on the blocker's screen.
- **Fix:**
  - Add a per-user, Redis-backed limiter for socket events, shared with the REST budget for messages so the two paths don't each get 60/min. A small token-bucket helper in `shared/` is fine. `rate-limiter-flexible` is also acceptable.
  - On `typing:*`, check `isBlockedPair` (cache it briefly) and throttle the event.
  - Validate every socket payload's shape and types (e.g. a zod schema or a hand-written guard). Ignore events that don't match.
  - Emit `message:error` with a rate-limit message when throttled.
- **Acceptance:** a socket test proves that more than N messages per minute get rejected, that REST and socket sends together share one budget, and that blocked users' typing events are dropped.

### 1.3 Rate limiting is broken behind a proxy (`trustProxy` missing)
- **Where:** `backend/src/app.ts`. `Fastify({...})` has no `trustProxy`. On Fly, Render or Railway every request comes through the platform proxy, so `req.ip` is the proxy's address.
- **Impact:** in production, **all users share one rate-limit bucket**. The global 200/min, login limits and so on apply to the whole user base. The app will start returning 429 to everyone at modest traffic.
- **Fix:** set `trustProxy` correctly for the chosen host (see Phase 2). Key authenticated routes by **user ID** (`keyGenerator`: `req.user?.sub ?? req.ip`). Note that `authenticate` runs as a preHandler, so either decode the token in an earlier `onRequest` hook or key per-route.
- **Acceptance:** a test with `X-Forwarded-For` shows different clients get separate buckets, and two authenticated users behind one IP get separate buckets.

### 1.4 Other users' email addresses leak
- **Where:** `GET /messaging/conversations` falls back to `peer.email` when there's no display name (`name: peerProfile?.displayName ?? peer.email`, and the same for `initial`). The chat screen also gets `name`, `initial` and `online` from **URL query parameters** (`/chat/<id>?name=carol…@mixit.test&initial=C&online=0`).
- **Fix:**
  - Never send another user's email or phone to a client. The fallback is `'MiXiT user'`, the same as rooms.
  - Change the chat route to take the peer ID only. Load the peer's display data from the API (add a `peer` object to the thread response, or call `GET /profiles/:userId`). Remove `name`, `initial` and `online` from the URL.
  - **Audit every response that includes another user** (matching, vibes, rooms, events, referrals, moderation, admin excluded). Add a test that walks those endpoints with seeded data and fails if any field contains another user's email or phone.
- **Acceptance:** the audit test passes, and no PII appears in any chat URL.

### 1.5 Exact distances allow trilateration
- **Where:** `backend/src/modules/matching/routes.ts`, `computeDistance`, which returns e.g. `"230m away"` or `"3.4km away"` from exact `locationLat` / `locationLng`.
- **Impact:** on a dating app, precise distances let an attacker spoof three locations and pin down where a user lives. This is a well-known real-world attack.
- **Fix:**
  - Never show metres. Floor values to whole kilometres with a minimum of "< 1 km", or use coarse buckets ("Nearby", "~5 km", "10+ km").
  - Round stored coordinates (about 2 decimal places, roughly 1 km) or snap them to a grid cell before saving and before computing.
  - Never return raw coordinates to other users. Verify every response.
- **Acceptance:** tests show that two users 150 m apart and 900 m apart get the same output, and no response contains another user's coordinates.

### 1.6 Auth tokens are stored unencrypted on the device
- **Where:** `stores/auth-store.ts` persists `accessToken` and the **30-day `refreshToken`** to AsyncStorage, which is plaintext.
- **Fix:** on iOS and Android, store tokens with `expo-secure-store` (Keychain/Keystore) through a custom Zustand storage adapter, keeping non-secret state in AsyncStorage. On web, document the trade-off and either keep the tokens in memory with a short-lived refresh or move web auth to an `httpOnly`, `Secure`, `SameSite` cookie on the refresh endpoint. Raise this choice with the owner (see §11).
- Migrate existing sessions once: read the old AsyncStorage key, write it to SecureStore, then delete the old key.
- Wire up `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`. They're documented in `.env.example` and `render.yaml` but **ignored**, because `shared/auth/jwt.ts` hardcodes `1h` / `30d`. Read them from `env` with validation and default the access token to `15m`. Also fix the hardcoded `expiresIn: '3600'` in the auth response.

### 1.7 Held (under-review) users can still send DMs
- **Where:** `shared/messaging/direct-messages.ts` selects `recipient.heldAt` and never uses it, and never checks the **sender's** `heldAt`. Room posting *does* block held senders (`rooms/routes.ts`).
- **Fix:** apply the same hold policy to DMs (REST and socket share this function, so one fix covers both). Decide what should happen when the *recipient* is held, e.g. accept but don't push-notify, and document it.
- **Acceptance:** a test shows a held sender gets 403 over both REST and socket.

### 1.8 The conversation list misses older conversations
- **Where:** `GET /messaging/conversations` loads the latest **200 messages** and groups them by peer in JS. A user with one long recent exchange loses every older conversation from the list.
- **Fix:** query the latest message per peer in SQL (e.g. `DISTINCT ON (LEAST(sender_id, recipient_id), GREATEST(...))` with `ORDER BY ... created_at DESC`, or a window function), paginated, with unread counts from the existing `messages_recipient_read_at_idx`. Alternatively, introduce a `Conversation` table (participants, `lastMessageId`, `lastMessageAt`, per-user `lastReadAt`) maintained in `sendDirectMessage` inside a transaction. Pick one and justify it in the PR. The table is preferred for scale.
- Exclude blocked and banned peers in the query, not in JS.
- **Acceptance:** with a seeded user holding 30 conversations, one of which has 500 recent messages, all 30 appear, in the right order, with correct unread flags.

### 1.9 Input validation gaps that cause 500s
- `GET /rooms/:roomId/messages`: `limit=abc` gives `NaN` and `before=garbage` gives an Invalid Date, and Prisma throws a 500. The DM thread `limit` has the same issue.
- Route params like `:peerUserId`, `:roomId` and `:userId` aren't validated as UUIDs.
- **Fix:** add JSON-schema `querystring` / `params` validation to **every** route (Fastify's built-in validation; `format: 'uuid'`, integer ranges, `date-time`). Add a global error handler that returns a consistent `{ ok: false, code, message }` shape, never leaks stack traces or Prisma internals, and maps Prisma `P2025` to 404 and `P2002` to 409.
- `messaging/routes.ts` `/media-upload` returns `error.message` to the client. Replace it with a generic message and log the details.
- **Acceptance:** a fuzz-style test that hits every route with malformed params gets 4xx, never 5xx.

### 1.10 Graceful shutdown
- **Where:** `backend/src/server.ts` has no `SIGTERM` / `SIGINT` handling. Every deploy or scale-down drops in-flight requests and cuts sockets abruptly. The `onClose` hook in `app.ts` never runs.
- **Fix:** on SIGTERM, stop accepting connections, call `app.close()` (which closes Socket.IO, Prisma and Redis through the existing hook), stop the reminders interval, and force-exit after a timeout (e.g. 10 s). Also make `closeSocketServer()` call `io.close()`. It currently only disconnects the Redis adapter clients.

### 1.11 Socket.IO CORS and the global CORS default
- Socket.IO uses `cors: { origin: true }`, which reflects any origin, while HTTP uses `env.corsOrigin`, which defaults to `'*'`. Make both use the same allow-list. In production, **fail boot** if `CORS_ORIGIN` is `*` or unset. Allow native apps, which send no `Origin` header. `render.yaml` sets `CORS_ORIGIN: "*"`, so fix it there too.

---

## Phase 2 — Production infrastructure

### 2.1 Pick one host
Fly, Render and Railway configs all exist, with different regions (JNB vs Frankfurt). **Ask the owner which host to use** (§11). The recommendation is **Fly.io `jnb`**: it's closest to the users, it may matter for POPIA data residency, and the team already has a `fly.toml`. Delete the configs that aren't used, and the duplicate root `Dockerfile` if it isn't needed. Update the README and the CI comment that references Railway.

### 2.2 Docker image
- Multi-stage build: compile in a builder stage, then copy `dist/`, the Prisma client and **production dependencies only** into a slim runtime stage.
- Run as a non-root user, set `NODE_ENV=production`, add `tini` or `--init` for signal handling (needed for 1.10), add a `HEALTHCHECK`, and pin the Node patch version to ≥ 20.19.
- Make the port consistent. The app defaults to 4000 while the image exposes 8080 and relies on `PORT`; set it explicitly.
- Add a `.dockerignore` for `backend/` if one is missing (no `.env`, no `node_modules`).

### 2.3 Migrations as a release step
- Render currently runs `prisma migrate deploy` in the **build** command, and the Docker/Railway path never runs migrations at all. Use a release phase (Fly: `[deploy] release_command = "npx prisma migrate deploy"`) so migrations run once per deploy, before new machines take traffic.
- Use `DIRECT_URL` (not the pgbouncer pooler URL) for migrations. Confirm `schema.prisma` has `directUrl = env("DIRECT_URL")`.

### 2.4 Uptime and scaling settings
- `fly.toml` has `min_machines_running = 0` and `auto_stop_machines = 'stop'`. That causes cold starts, drops WebSocket connections when idle, and means **event reminders never fire** while the app is scaled to zero (`startEventReminders` runs in-process). Set `min_machines_running = 1` for launch, or `2` for high availability.
- `[[vm]]` has both `memory = '256mb'` and `memory_mb = 1024`, which conflict. Pick one; 512 MB to 1 GB is realistic for Prisma plus Socket.IO.
- **More than one instance needs Redis.** The Socket.IO adapter and the rate limiter both depend on it. In production, fail boot if `REDIS_URL` is missing, or get the owner to sign off on running a single instance with in-memory limits.
- Configure WebSocket sticky sessions or pure-websocket transport. Socket.IO's polling fallback needs sticky sessions across multiple instances.

### 2.5 Redis failure behaviour
- The rate limiter uses `skipOnError: true`, so **a Redis outage removes all rate limiting**. Keep it fail-open for availability, but add an alert when Redis is down (Phase 3), and consider a smaller in-memory fallback limiter so abuse protection never drops to zero.

### 2.6 Database
- Turn on automated backups and point-in-time recovery for the production Postgres (Supabase plan check). **Do one restore drill to a scratch database and document it** in `docs/runbooks/restore.md`.
- Set Prisma connection pool limits suited to the pooler (`connection_limit`, `pool_timeout`) and document them.
- Review indexes against the new queries from Phase 1 and Phase 4, and add any that are missing through migrations.

### 2.7 Configuration hygiene
- `backend/.env.example` sets `NODE_ENV=production`, which is wrong for local dev. Split it into `.env.example` (local defaults) and `docs/deploy/production-env.md`, which lists every production variable, whether it's required, and how to generate it.
- Validate all production-required variables at boot in `shared/config/env.ts`: `PUBLIC_API_URL`, `SUPABASE_*`, `REDIS_URL` (per 2.4), `CORS_ORIGIN` (per 1.11), `SENTRY_DSN` and the Google/Apple client IDs that apply.
- App side: one Expo config per EAS profile (`development`, `preview`, `production`) via `app.config.js` and `eas.json`. `EXPO_PUBLIC_API_URL` must be HTTPS in preview and production builds; fail the build if it isn't.

### 2.8 Health checks
- Split `/health` into `/health/live` (process up, no dependencies) and `/health/ready` (DB `SELECT 1` plus a Redis ping, short timeouts). Point the platform's health check at `ready`. Don't expose `environment` publicly, or keep it minimal.

---

## Phase 3 — Observability

- [ ] **Sentry on both sides.** The backend already has it. Add `@sentry/react-native` to the app, set up releases tied to the git SHA / EAS build, upload source maps (Expo plugin) and set environment tags. Set `tracesSampleRate` to a sensible value for production.
- [ ] **PII scrubbing:** Sentry `beforeSend` plus the logger must redact emails, phone numbers, tokens, `Authorization` headers, message `content` and coordinates. Add a unit test for the redactor.
- [ ] **Structured logs:** every log line carries `requestId` (the middleware already exists) and `userId` when known. Never log message bodies.
- [ ] **Metrics:** request rate, latency (p50/p95/p99) and error rate per route; connected sockets; messages per minute; 429 counts; Redis and DB health. Use the host's metrics or a Prometheus endpoint protected by a token.
- [ ] **Uptime monitor** on `/health/ready` from outside the host, alerting the owner (email or WhatsApp).
- [ ] **Alerts:** 5xx rate above threshold, p95 latency above threshold, Redis down, PayFast payment-confirmation (ITN) verification failures, an unusual spike in reports.
- [ ] Write `docs/runbooks/` for: API down, DB down, Redis down, a payment-confirmation (ITN) issue, a spam wave, and how to roll back a deploy.

---

## Phase 4 — Performance and scale

### 4.1 Discover doesn't scale
- **Where:** `GET /matching/candidates`.
- **Problems:**
  1. The candidate pool is only the **40 most recently updated profiles** (plus up to 40 perk holders). Once there are a few hundred users, everyone sees roughly the same 40 people, and anyone who hasn't edited their profile lately never appears.
  2. The launch-city filter runs **after** `take: 40`, so many valid candidates can be cut before filtering and Discover comes back empty.
  3. `userId: { notIn: [...all users I ever vibed + blocked] }` grows forever and gets sent as a huge parameter list.
  4. There's no filtering by the viewer's preferences (gender or age range they want to see). See §11. The schema has no preference fields.
  5. Distance is computed in JS after the fetch, so "nearby" can't drive the query.
- **Fix:** move filtering into SQL. Exclude vibed and blocked users with `NOT EXISTS` subqueries, filter by launch city and (once decided) preferences in the `WHERE`, and do distance with a bounding-box prefilter (indexed lat/lng) or PostGIS (`geography` plus a GiST index). Supabase supports PostGIS. Add cursor pagination or a "fetch next batch". Keep the existing scoring and the Boost/Premium ordering, which matches what the product descriptions promise.
- **Acceptance:** with 5,000 seeded profiles, p95 under 150 ms locally, results vary across the pool, and the launch-city users never get an empty list while eligible candidates exist.

### 4.2 Query review
- Run `EXPLAIN ANALYZE` on the hot paths: candidates, conversations, thread, room messages, vibes inbox. Add indexes through migrations where needed.
- Remove N+1 patterns. For example, `sendDirectMessage` does two profile lookups per message; fetch them in one query or cache display names.
- Profile caching already exists in `shared/cache/redis.ts`. Check its invalidation on profile update and block.

### 4.3 Load test
- Add `k6` (or Artillery) scripts in `loadtest/` for: sign-in → candidates → vibe → open thread → send 20 messages over the socket → room post. Agree targets with the owner (§11); a reasonable starting point is 1,000 concurrent sockets and 50 messages/s at p95 under 300 ms on a single launch-size instance. Record the results in `docs/performance.md`.

---

## Phase 5 — App (frontend)

- [ ] **Split `app/(tabs)/index.tsx` (2,347 lines).** It holds sign-in (Google, Apple, reviewer), profile editing, photos, voice intro, location, phone, referrals, premium entry and account deletion. Extract screens and components (`features/auth/*`, `features/profile/*`, …) step by step, one PR per extraction, with no behaviour change. Do this **before** fixing UI bugs in that file.
- [ ] **Dev-only UI:** the sign-in screen shows `Backend: http://localhost:4000` and "Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to enable it." Show these only when `__DEV__` is true. In production, hide unavailable sign-in options instead of explaining configuration.
- [ ] **Online status:** the chat header shows "offline" with a **green** dot. Fix the colour logic. Respect `showLastSeen` (it exists in the schema; verify the API honours it everywhere `lastActive` or `online` is returned).
- [ ] **Desktop web layout:** content stretches across the full width. Cap the main column (about 600–720 px) and centre it. Make the bottom tabs fit the narrower column.
- [ ] **Error handling:** add an error boundary per tab and route, consistent API error toasts, retry on network failure (React Query), and a visible offline banner. Socket reconnect should refresh the open thread so nothing is missed.
- [ ] **Chat UX:** "load earlier" (from 1.1), optimistic sends with failed-send retry, de-duplication between the socket echo and the REST response, and correct scroll anchoring.
- [ ] **Accessibility:** `accessibilityLabel`s on icon buttons, text contrast against the decorative backdrop, support for Dynamic Type / font scaling, and screen-reader order on the key screens.
- [ ] **Performance:** use FlashList for chats, rooms and Discover (it's already a dependency), and compress images before upload (`lib/media.ts` exists; verify it's used everywhere).
- [ ] **Frontend tests:** add `jest-expo` and React Native Testing Library. Cover the auth store migration (1.6), chat pagination and de-duplication, and the sign-in screen's dev-only text gating.

---

## Phase 6 — Trust, safety and compliance

> These need owner input (§11). Build mechanisms, don't decide policy, and flag legal questions for a lawyer. Don't present them as settled.

- [ ] **Age assurance:** profiles store `age` as an `Int`, which goes stale, and 18+ is a checkbox plus `minimum: 18` on the profile schema. Store `dateOfBirth`, compute age server-side, enforce 18+ at profile creation **and** on every update, and make DOB immutable without support. Migrate existing rows (expand → backfill an approximate DOB → contract).
- [ ] **Dead privacy field:** `Profile.showPhone` defaults to `true` but nothing reads it. Remove it, or implement it with default **`false`** (privacy by default).
- [ ] **Account deletion completeness:** verify `DELETE /auth/...` removes or anonymises the profile, messages (decide: delete, or keep the other party's copy anonymised), vibes, room messages, push tokens, refresh sessions and **all Supabase Storage objects** (photos, voice intros, chat media). Write a test that seeds a full user, deletes them, and checks nothing identifiable remains.
- [ ] **Data export** (POPIA data-subject access): add an authenticated endpoint that returns the user's data as JSON.
- [ ] **Retention:** define and implement retention for messages from banned users, reports, logs and media of deleted accounts, as a scheduled job using the same claim pattern as `shared/events/reminders.ts`.
- [ ] **Moderation:** confirm reports reach the moderation webhook, document the admin workflow (`/admin/*` with `x-admin-key`), and add image moderation for profile and chat photos (or at least report-driven takedown with SLAs). Check that the content filter covers room messages, bios and display names, not just DMs.
- [ ] **App Store / Play checklist** (`docs/store-compliance.md`): in-app account deletion ✔ (verify), block and report on all user-generated content ✔ (verify), Sign in with Apple offered alongside Google on iOS ✔ (verify), the reviewer demo account works on a production build, privacy labels / data safety form match what's actually collected (location, photos, voice, messages), age rating 18+, and links to the legal pages from `/legal`.
- [ ] **POPIA items for the owner:** an Information Officer registered with the Information Regulator, a privacy policy that matches the actual data flows, cross-border transfer if the database or Redis are hosted outside South Africa (e.g. Render Frankfurt, Supabase region), and operator agreements with Supabase, Sentry, PayFast and RevenueCat. Document the facts; the owner decides with legal advice.

---

## Phase 7 — Testing and CI

- [ ] **Backend integration tests** with `fastify.inject()` against the CI Postgres for every route module: auth (including refresh-reuse detection), profiles, matching, messaging, rooms, events, payments (including PayFast confirmation (ITN) amount-mismatch and replay), moderation, referrals and admin auth. Each P0 fix in Phase 1 needs at least one of these.
- [ ] **Socket tests:** auth handshake, a banned user rejected, message send/receive, rate limiting, typing with blocks, room join only for members.
- [ ] **Coverage:** report coverage in CI. Set a backend floor (e.g. 70% lines on `src/modules` and `src/shared`) and raise it over time.
- [ ] **E2E:** Playwright for the web build covering sign in (reviewer path) → Discover → Vibe → Chat → Room post. Maestro flows for native are optional for launch and recommended after.
- [ ] **Security in CI:** `pnpm audit --prod` (fail on high or critical), Dependabot or Renovate for both lockfiles, `gitleaks` for secret scanning, and CodeQL for JS/TS.
- [ ] **CI Node version:** set `NODE_VERSION` to `20.19.x` (Expo SDK 54's minimum), not `'20'`.
- [ ] **Branch protection:** CI required on `main` and `dev`, PR review required. List this for the owner to switch on in GitHub settings.

---

## Phase 8 — Release process

- [ ] **Staging environment** that mirrors production (same host and region, separate database and Redis, PayFast sandbox, RevenueCat sandbox). `dev` auto-deploys to staging; `main` deploys to production after manual approval.
- [ ] **EAS:** a `preview` channel goes to staging and `production` goes to production. Document the OTA update policy: JS-only fixes via `eas update`, native changes via store builds. Use `runtimeVersion` so OTA updates never reach incompatible binaries.
- [ ] **Versioning:** semantic version plus an auto-incremented build number. Add a `CHANGELOG.md`.
- [ ] **Rollback:** document and test a backend rollback (previous image) and an OTA rollback. Thanks to backward-compatible migrations (rule 4), rolling back the code never needs a database rollback.
- [ ] **Feature flags:** a simple server-driven config (`GET /config`) for the launch-city gate, payments on/off and new features, so incidents can be mitigated without a release.
- [ ] **Launch checklist** in `docs/launch-checklist.md`: every item in this brief ✔, load-test results, restore drill done, alerts tested by firing one, store listings approved, legal pages live, on-call contact defined.

---

## 10. Already done well — don't break these

- **PayFast payment confirmation (ITN):** server-side validation with PayFast, merchant-ID check, amount check and idempotent handling of retries.
- **Refresh tokens:** hashed at rest, rotated, with **reuse detection** that revokes the session family.
- **One send path for DMs:** `sendDirectMessage` serves REST and socket, so blocks, bans, the content filter and media-ownership checks apply to both. Keep it that way, and put the new limits (1.2, 1.7) inside or next to it.
- **JWT secret validation** in production, and the minimum length on the admin key.
- **Timing-safe comparison** for the reviewer password and the admin key.
- **Room message pagination** (newest-first, reversed, `before` cursor). Use it as the model for 1.1.
- **The event reminders job** claims work with `updateMany`, so it's safe across instances.
- **Redis-backed rate limiting** and the Socket.IO Redis adapter design.
- **CI checks** for migration/schema drift and Expo dependency versions.

---

## 11. Decisions needed from the owner (ask, don't assume)

1. **Hosting:** Fly `jnb` (recommended), Render or Railway? Where are the database and Redis hosted (region)?
2. **Instances at launch:** 1 (simpler) or 2+ (high availability; needs Redis, sticky sessions and a higher budget)?
3. **Discover preferences:** should users filter by gender they want to see and an age range? This is a product decision and needs new profile fields and UI.
4. **Web auth model:** keep tokens in memory with a short refresh window, or move to `httpOnly` refresh cookies (needs the web app and API on the same site, or CORS with credentials)?
5. **Deleted-account messages:** delete them entirely, or keep the other person's copy with the sender anonymised?
6. **Held recipients:** if a recipient's account is under review, should incoming DMs be accepted silently, queued, or rejected?
7. **Performance targets** for launch: expected users, concurrent sockets, messages per second.
8. **Retention periods** for messages, reports, logs and media.
9. **POPIA/legal:** Information Officer, privacy-policy owner, cross-border hosting acceptance. These go to legal counsel.
10. **Monitoring budget:** Sentry plan and uptime tool, and where alerts go (email, WhatsApp, Slack).

---

## 12. How to report back

- At the start: confirm you've read this brief, list anything you think is wrong or missing after looking at the code, and post the Phase 0 baseline (CI status and any pre-existing failures).
- **One PR per item or small group of related items.** Each PR description has: what was wrong (with evidence), what changed, how it was tested, migration and rollback notes, and screenshots for UI changes.
- Keep `docs/PRODUCTION_READINESS.md` current. At the end of each phase, post a short summary: done, deferred (with reason), and decisions still blocking progress.
- **Order of work:** Phase 0 → Phase 1 (1.1–1.11, in that order) → Phase 2 → Phase 3, then Phases 4–8, which can overlap. Don't start Phase 5's UI fixes in `index.tsx` until it has been split.
