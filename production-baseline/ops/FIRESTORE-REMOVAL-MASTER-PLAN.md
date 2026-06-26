# Firestore Removal — Master Inventory & Phased Plan (REPORT — no build yet)

**This is the authoritative document.** It supersedes `FIRESTORE-TO-PG-ORDER-MIGRATION-PLAN.md`
(kept for route-level detail). Per your instruction: **report first; each phase is built only after you approve it.** Nothing here is deployed.

## Final architecture (permanent)
Firebase is allowed **ONLY** for: (1) Phone OTP / Firebase Authentication, (2) FCM push notifications.
**Firestore must not hold or serve ANY business data.** End state = **zero** Firestore business-data dependency, **zero** Firestore fallback.
Must not break: OTP login, driver plans, wallet, Razorpay, profile, KYC.

---

## A. COMPLETE FIRESTORE INVENTORY (current state)

### A1. Surfaces I CAN see (in this repo / available artifacts)
- **API** = the live prod esbuild bundle `dist/production-api.js` (base `2ce3e5ea…`). Source is lost; inventory is from the bundle itself.
- **Driver App** = `artifacts/mobile` (full source).

### A2. Surfaces I CANNOT see — **hard blocker for a truly "complete" inventory**
- **Customer App** — NOT in this repo.
- **Admin Panel** — NOT in this repo (the API has admin routes, but the admin *frontend* is external).

Both can talk to Firestore **directly via the client SDK** (e.g. a customer `onSnapshot(orders/:id)` live-tracking listener) — that path is **invisible from here** and cannot be inventoried or removed without their source. **To deliver rule #1/#5/#6 (complete inventory, apps read ONLY VPS, no fallback anywhere) you must provide the Customer App and Admin Panel source (or repo access).** Everything below is complete for API + Driver App; the customer/admin client-side rows are inferred from the API they call and must be confirmed against their source.

### A3. API bundle — every Firestore collection in use (74 `db2` ops total)

| Collection (refs) | Domain | In removal scope? | Notes |
|---|---|---|---|
| `orders` (27) | order create/list/detail/status/cancel/dispatch/offers/stream/tracking | **YES** | All `db2.collection("orders")…`; SSE `/orders/:id/stream` uses Firestore `onSnapshot`. |
| `orders/.../private` (2) | **order OTP** | **YES** | `orders/:id/private/otp` doc holds the drop OTP. → move to PG (§C4). |
| `drivers` (7) | driver doc: FCM-token shadow, presence, order markers | **YES (writes)** | PG is already primary for token/location/status; Firestore writes here must stop. FCM *sending* stays. |
| `notifications` (8) | in-app notification feed | **YES** | Business data. FCM delivery is allowed; the stored feed must move to PG. |
| `notificationHistory` (2) | sent-push log | **YES** | Business data audit → PG. |
| `adminActions` (3) | admin audit trail | **YES** | Admin Panel business data → PG. |
| `activityLogs` (2) | activity/audit log | **YES** | Business data → PG. |

> `onSnapshot` appears 18× in the bundle, but most are inside the vendored firebase-admin/grpc library; the **only business listener** is the order SSE stream. `FieldValue.serverTimestamp ×19, increment ×12, arrayUnion ×5, arrayRemove ×4` — all order/driver/notification writes that become PG column writes.

### A4. Driver App (`artifacts/mobile`) — remaining Firestore (everything else already PG/SSE)

| File | Symbol | Firestore op | Disposition |
|---|---|---|---|
| `utils/firebase.ts` | `getFirestore` → `db` (L73, L87) | init Firestore handle | **Remove** `db`/`getFirestore` once `firestore.ts` no longer needs it. **Keep** Auth + messaging init. |
| `utils/firestore.ts` | `updateDriverPushToken` (L141) | `setDoc(drivers/:uid)` FCM-token shadow write | **Remove FS write** — token is PG-primary via `PATCH /drivers/me/fcm-token`. |
| `utils/firestore.ts` | `fetchOrderById` (L260) | `getDoc(orders/:id)` **fallback** | **Remove fallback** — API-only `GET /orders/:id` (needs PG/driver-auth variant, §B). |
| `utils/firestore.ts` | `getActiveOrdersForDriver` (L308) | `getDocs(query(orders, where driverUid, where status in ACTIVE_STATUSES))` **fallback** | **Remove fallback** — API-only `GET /drivers/:uid/active-orders` (§B). |
| `utils/firestore.ts` | `OrderDoc`/`OrderStatus`/`ACTIVE_STATUSES`, `rejectOrder`/`timeoutOrder`/`driverCancelOrder` | types + API-calling fns (no direct FS) | **Keep**, but move types out of the Firestore module so `db` import can be deleted. |

Consumers of `utils/firestore.ts` (must keep compiling after the FS code is stripped): `order-stream.ts` (types only), `delivery-api.ts`, `DriverContext.tsx`, `_layout.tsx`, `active-delivery.tsx`, `ride-request.tsx`, `(tabs)/trips.tsx`.
Clean already: `order-stream.ts` (pure SSE, no FS), `DriverContext` L2145 is a **stale comment** only.

### A5. Customer App — INFERRED (confirm against source)
From the API it calls (all Firestore-backed today): create `POST /orders`, list `GET /orders`, detail `GET /orders/:id`, **live track `GET /orders/:id/stream`** (Firestore `onSnapshot`), cancel `POST /orders/:id/cancel`, OTP read `GET /orders/:id/private-otp`, rating. **Likely also a direct client-SDK `onSnapshot(orders/:id)` for tracking — unconfirmed.**

### A6. Admin Panel — INFERRED (confirm against source)
Touches `adminActions`, `activityLogs`, `orders` (reassign/reveal-otp), `drivers`, `notifications`. Direct client-SDK Firestore usage unconfirmed.

---

## B. Missing VPS APIs to build (driver app already calls these; bundle has 0)
`GET /drivers/:uid/active-orders`, `GET /drivers/me/offer-stream` (SSE), `POST /orders/:id/{accept,reject,timeout,driver-cancel,complete}`, `PATCH /orders/:id/{stage,location}`, PG/driver-auth `GET /orders/:id`, PG `GET /orders/:id/stream`, `GET /drivers/me/trips`, `POST /drivers/register-keys`. Plus customer-side PG variants: create/list/detail/**track stream**/cancel/active-order/OTP. (Already correct & PG-backed — do not rebuild: `POST /drivers/:uid/location`, `PATCH /drivers/:uid/status`, `PATCH /drivers/me/fcm-token`, `GET /drivers/me`.)
Reference implementations for most driver routes exist in the un-deployed `artifacts/api-server` source and must be adapted to the bundle's pool/auth and shipped as byte-safe additive patches.

## C. Design (summary; full detail in the order plan doc)
- **C1 Tables:** reuse PG `orders` (+`ADD COLUMN IF NOT EXISTS` for dispatch/stage/tracking/cancel fields); `order_offers` for the pool (FK → parent order must exist first); migrate `notifications`/`activityLogs`/`adminActions` to PG tables.
- **C4 Order OTP:** PG, never Firestore — recommend `order_secrets(order_id PK, otp, created_at)` so OTP never serializes into any order read/stream. Driver already verifies server-side.
- **C5 Realtime:** PG-backed SSE for `/orders/:id/stream` and `/drivers/me/offer-stream` via Postgres `LISTEN/NOTIFY` (push) — NOT Firestore. Reliability fixes are already in the Driver App SSE client (270s pre-emptive recycle for the proxy's silent ~300s clean-close, fresh idToken per reconnect, Last-Event-ID resume); the server must send ≤25s heartbeats and re-emit current state on connect.
- **C6 Cleanup/backfill:** the Part A one-time script for the current stuck order; a one-time backfill of still-open Firestore orders into PG with the same doc id; an ongoing TTL sweeper so a Firestore outage can never strand a ride again. Lock the status vocabulary (`finding_driver`/`searching`/…) across PG enums in lockstep.

---

## D. Phased plan (build each ONLY after approval; no mirror/cutover flag without explicit go-ahead)

- **Phase 0 — PG schema parity.** Idempotent `ADD COLUMN/TABLE IF NOT EXISTS`; lock status vocabulary. No behavior change.
- **Phase 1 — Add missing PG-backed driver+order routes additively** (byte-safe bundle patch); PG authoritative, projects to Firestore so the still-Firestore customer app keeps working; order OTP in PG; TTL sweeper. Driver app's PG calls stop 404-ing. No flag flipped.
- **Phase 2 — Driver App reads ONLY VPS.** Stand up PG-backed `/orders/:id/stream` + `/drivers/me/offer-stream`; remove all Driver App Firestore fallbacks (§A4) and the `getFirestore` init. Requires approval.
- **Phase 3 — Customer App + Admin Panel read ONLY VPS.** **Blocked on their source.** Add customer/admin PG routes incl. PG track stream; remove their client-side Firestore.
- **Phase 4 — Remove Firestore from business data entirely.** Strip all `db2.collection(...)` from the bundle; drop the Firestore projection; migrate `notifications`/`notificationHistory`/`adminActions`/`activityLogs` to PG. Verify by grep: **zero** business `db2` ops remain. Firebase left only for Auth/OTP + FCM.

Every phase: report → your approval → idempotent SQL first → byte-safe additive patch → before/after SHA256 provided → **you** deploy. No auto-deploy. OTP-login, driver-plan, wallet, Razorpay, profile, KYC routes are not modified (if an order route ever needs a payment field it will be proven and flagged first).

---

## E. What I need from you to proceed
1. **Customer App source/access** and **Admin Panel source/access** — mandatory for a complete inventory and for Phases 3–4 (rules #1, #5, #6). Without them I cannot guarantee "no Firestore fallback anywhere."
2. Confirm the authoritative **order status vocabulary** (all pool/active statuses the customer app writes).
3. **Approval to start Phase 0 + Phase 1** (non-breaking; directly eliminates the stuck-order bug class). I will build, hash, and hand off; you deploy.
