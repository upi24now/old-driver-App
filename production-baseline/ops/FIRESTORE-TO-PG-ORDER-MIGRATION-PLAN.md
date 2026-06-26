# Order Lifecycle: Firestore → VPS/PostgreSQL Migration Plan (REPORT — no code yet)

**Status:** Report-first. No implementation until you approve. No deploy.
**Final architecture rule:** Firebase is allowed ONLY for (1) Phone OTP/Auth and (2) FCM. No Firestore for order/business data.
**Do not touch:** OTP-login routes, driver-plan routes, customer payment/Razorpay routes (unless an order route provably requires it).

---

## 0. Executive summary — the actual root cause

The order flow is **split across two codebases that disagree**:

- **Live prod API** = the prebuilt esbuild bundle on the VPS (`dist/production-api.js`, base `2ce3e5ea…`). Its order routes are **almost entirely Firestore-backed** (`db2.collection("orders")…`). The driver-facing PG order routes the app needs **do not exist** in this bundle.
- **Driver App** (`artifacts/mobile`) has **already moved to PG-primary REST**: it calls `/accept`, `/complete`, `/stage`, `/active-orders`, `/offer-stream`, etc., and only falls back to Firestore when those calls fail.

Result: the app calls PG routes that 404 on prod → it silently falls back to Firestore → orders live half in Firestore, half nowhere. When Firestore hits **RESOURCE_EXHAUSTED** (quota), writes fail and an order gets **stuck active** (exactly the `1cJqStLYLBmdxPbJ50j7` case: 0 PG rows, Firestore exhausted, customer cancel 401 because cancel is customer-auth + Firestore).

**The migration is therefore mostly a "port the already-written PG order routes into the prod bundle, additively, and stop the app from ever needing Firestore for orders" exercise** — not a from-scratch build. The PG implementations already exist as reference in `artifacts/api-server` (un-deployed source); they must be adapted to the bundle's pool/auth and shipped as byte-safe additive blocks (same pattern as the OTP/PIN/driver-plan patches already delivered).

---

## 1. Firestore order/dispatch/active-ride reads & writes (current state)

### 1a. Live prod API bundle (`production-api.js`, base `2ce3e5ea`) — ALL under `/api`
Order router (`orders_default` / customer order router, mounted via `routes_default`):

| Route | Auth | Backing | Notes |
|---|---|---|---|
| `POST /api/.../orders` (create) | customerAuth | **Firestore** | `db2.collection("orders").doc()` + `private/otp` subdoc; `FieldValue.serverTimestamp()`; sets `activeOfferDriverUids:[]`, `deliveryOtp`. |
| `GET /api/.../orders` (list) | customerAuth | **Firestore** | |
| `GET /api/.../orders/:id` | customerAuth | **Firestore** | Driver also calls this → customerAuth rejects driver token. |
| `GET /api/.../orders/:id/stream` (SSE) | customerAuth | **Firestore `onSnapshot`** | Live order stream depends on Firestore listener; 30s ping heartbeat. |
| `PATCH /api/.../orders/:id/status` | customerAuth | **Firestore** | `db2…update({status,...extra})`. |
| `POST /api/.../orders/:id/cancel` | customerAuth | **Firestore** | This is the customer cancel that returns 401 for the stuck order. |
| `POST /api/.../orders/:id/dispatch` | — | **Firestore** | Offer-pool dispatch. |
| `POST /api/.../orders/:id/offers` | customerAuth | **Firestore** | |
| `DELETE /api/.../orders/:id/offers/:driverUid` | — | **Firestore** | This is the only "remove from pool" (driver-reject equivalent). |
| `GET /api/.../orders/:id/private-otp` | customerAuth | **Firestore** | OTP read from `orders/:id/private/otp`. |
| `PATCH /api/.../orders/:id/rating` | customerAuth | **Firestore** | |
| `GET /api/.../drivers/online` | — | mixed | Driver presence. |

Driver routes that ARE already PG-backed in the bundle (keep, do not rebuild):
- `POST /api/drivers/:uid/location` (driverAuth) → `db.insert(driverLocationsTable)` (PG). ✅
- `PATCH /api/drivers/:uid/status` (driver online/offline) → PG. ✅
- `PATCH /api/drivers/me/fcm-token`, `GET /api/drivers/me` → PG (added by prior patches). ✅
- Admin order ops `POST /api/orders/:id/reveal-otp`, `/reassign-driver` (admin). 

> Total `customerAuth` order routes in bundle: **30**. Order create/list/detail/stream/status/cancel/dispatch/offers/OTP are **100% Firestore**.

### 1b. Driver App (`artifacts/mobile`) — already PG-primary, Firestore = fallback/shadow only
| Concern | File / function | Firestore role TODAY |
|---|---|---|
| Incoming offers (popup) | `utils/order-stream.ts → listenToAllDispatchedOrders` → SSE `GET /api/drivers/me/offer-stream` | Firestore `onSnapshot` **already replaced** by SSE. |
| Active ride live status | `utils/order-stream.ts → listenToActiveOrder` → SSE `GET /api/orders/:id/stream` | SSE; Firestore only if SSE missing. |
| Session restore (active rides) | `utils/firestore.ts → getActiveOrdersForDriver` → `GET /api/drivers/:uid/active-orders` | API-primary, **Firestore fallback** (`driverUid` + status in ACTIVE_STATUSES). |
| Order detail | `utils/firestore.ts → fetchOrderById` → `GET /api/orders/:id` | API-primary, Firestore fallback. |
| Accept | `utils/delivery-api.ts` → `POST /api/orders/:id/accept` | API only. |
| Reject / Timeout / Driver-cancel | `utils/firestore.ts` → `POST /api/orders/:id/{reject,timeout,driver-cancel}` | API only (server projects to Firestore). |
| Stage (to_pickup→at_pickup→to_drop→at_drop) | `utils/delivery-api.ts` → `PATCH /api/orders/:id/stage` | API only. |
| Complete (+ OTP) | `utils/delivery-api.ts` → `POST /api/orders/:id/complete {otpEntered}` | API only; **OTP verified server-side against PG** (app reads no OTP from Firestore). |
| Driver GPS on order | `utils/delivery-api.ts` → `PATCH /api/orders/:id/location` | API; server mirrors `driverLat/Lng/locationUpdatedAt` to Firestore. |
| Push token shadow | `utils/firestore.ts → updateDriverPushToken` → `drivers/:uid` | Firestore dual-write (FCM fallback — **allowed to keep**, it's FCM-related). |

### 1c. Customer App — **EXTERNAL, not in this repo**
Cannot be inventoried from here. **Action item for you:** provide (or grant access to) the Customer App so its Firestore order reads/writes can be inventoried. Best current inference from the API it calls: it does `onSnapshot` on `orders/:id` for live tracking, creates orders via `POST /orders`, reads OTP, and cancels via `POST /orders/:id/cancel`. Phase 3 cannot complete without this inventory.

---

## 2. Exact API routes MISSING on the live VPS bundle (confirmed by literal scan)

Driver App calls these; the prod bundle has **zero** route definitions for them:

| Missing route | Used by (mobile) | Purpose |
|---|---|---|
| `GET  /api/drivers/:uid/active-orders` | session restore | driver's current active rides (≤3) |
| `GET  /api/drivers/me/offer-stream` (SSE) | dispatch popup | incoming offer pool live stream |
| `POST /api/orders/:id/accept` | accept | claim an offer |
| `POST /api/orders/:id/reject` | reject | leave offer pool (bundle only has `DELETE …/offers/:driverUid`) |
| `POST /api/orders/:id/timeout` | offer timer | offer expiry |
| `POST /api/orders/:id/driver-cancel` | cancel pre-pickup | driver cancels accepted order |
| `POST /api/orders/:id/complete` | drop | terminal completion + OTP verify |
| `PATCH /api/orders/:id/stage` | delivery flow | advance to_pickup/at_pickup/to_drop/at_drop |
| `PATCH /api/orders/:id/location` | live map | driver GPS on the order |
| `GET  /api/drivers/me/trips` | history | trip history |
| `POST /api/drivers/register-keys` | signup | duplicate phone/license/vehicle check |

Present-but-wrong for the driver (exist, but customer-auth + Firestore → must get PG/driver-auth variants):
- `GET /api/orders/:id` and `GET /api/orders/:id/stream` — customer-gated + Firestore. Driver needs PG-backed, driver-auth-capable versions.

Already correct (do NOT rebuild): `POST /api/drivers/:uid/location`, `PATCH /api/drivers/:uid/status`, `PATCH /api/drivers/me/fcm-token`, `GET /api/drivers/me`.

---

## 3. PostgreSQL schema design (reuse existing `orders` table)

Reuse the existing PG `orders` table (Drizzle). Add only what's missing. Proposed columns (all nullable/defaulted so existing rows are unaffected — same safety stance as the driver-plan PIN columns):

**`orders`** (extend):
- `id` (text, = Firestore doc id during transition so IDs stay stable), `user_id`, `type`, `status`, `vehicle_type`, `delivery_mode`, `distance_km`, fare fields (`base_fare`, `price_per_km`, `platform_fee`, `gst`, `total_amount`, `fare_estimate`, `vehicle_slug`), `items` (jsonb), pickup/drop (`pickup_lat/lng/address`, `drop_lat/lng/address`).
- Dispatch/offer: `active_offer_driver_uids` (text[]), `dispatch_timeout_at`, `offer_expires_at`, `driver_uid` (assigned), `dispatch_status`.
- Live tracking: `driver_lat`, `driver_lng`, `location_updated_at`.
- Lifecycle stage: `stage` (to_pickup|at_pickup|to_drop|at_drop|delivered), `accepted_at`, `picked_up_at`, `delivered_at`.
- Cancel/audit: `cancelled_by`, `cancel_reason`, `cancelled_at`, `created_at`, `updated_at`.

**`order_offers`** (already referenced in prior PG work — keep): `(order_id FK, driver_uid, offered_at, expires_at, result)` for the dispatch pool; FK requires the parent `orders` row to exist first (known FK-race — see Phase 1 note).

**Indexes:** `orders(driver_uid, status)` for active-orders; `orders(status, dispatch_timeout_at)` for redispatch sweeps; `order_offers(driver_uid, result)`.

Most of this already exists in `artifacts/api-server`'s schema and the prod PG (`driverLocationsTable`, `orders`, wallet tables are live). Phase 0 = diff prod PG against the needed columns and `ADD COLUMN IF NOT EXISTS` only the gaps (idempotent migration, no data change), exactly like `001_driver_plan_activation.sql`.

## 4. Order OTP in PostgreSQL (not Firestore)

- Store the 4-digit drop OTP in PG, **not** in `orders/:id/private/otp`.
- Option A (simplest, server-only): column `orders.delivery_otp` (text) written at create, never returned to the driver; verified at `POST /orders/:id/complete`.
- Option B (cleaner separation): `order_secrets(order_id PK, otp, created_at)` so the OTP never rides on the order row that gets serialized to clients.
- **Recommendation: Option B** — guarantees the OTP is never accidentally serialized into any order read/stream payload. The driver app already verifies server-side (sends `otpEntered`, server compares), so no client change is needed.

## 5. Realtime from VPS/PG (not Firestore)

Two SSE endpoints, both reading PG (no Firestore listener):
- `GET /api/orders/:id/stream` (driver + customer): on connect, send current row; then push `order.update` on change.
- `GET /api/drivers/me/offer-stream` (driver): push offers from `order_offers`/`orders.active_offer_driver_uids`.

**How to detect PG changes** (pick one, recommend the first):
1. **Postgres `LISTEN/NOTIFY`** — order write paths `NOTIFY order_<id>`; SSE handler `LISTEN`s and pushes. True push, no polling.
2. Short-interval poll (1–2s) per connection — simpler, heavier; acceptable as a fallback.

**Critical reliability constraints (from prior production incidents — must be designed in, not discovered later):**
- The reverse proxy does a **clean 300s close** of SSE connections with no error event. `react-native-sse` with `pollingInterval:0` treats a clean close as success and **never reconnects** → the stream silently dies and the foreground driver stops getting popups. **Fix in design:** server sends periodic comment/ping (≤25s) AND the client must recreate the EventSource on close, not only on error.
- Heartbeat/ping every ≤30s to keep the proxy from idle-closing.
- Fresh `idToken`/auth per (re)connect.
- Dispatch "added" path must write `active_offer_driver_uids` + `dispatch_timeout_at` so the offer snapshot is non-empty (prior popup-gap bug where FCM succeeded but in-app snapshot was size 0).

## 6. Cleanup / backfill for existing stuck Firestore orders

- **One-off (this incident):** `production-baseline/ops/cleanup-stale-order.mjs` (Part A) cancels the single stuck order surgically. Reusable by changing the two IDs at top.
- **Backfill:** one-time script to copy still-open Firestore orders (`status in {pending, finding_driver, searching, driver_assigned, to_pickup..at_drop}`) into PG with the **same doc id** (so the app's stable order ids keep working). Idempotent `INSERT … ON CONFLICT (id) DO NOTHING`.
- **Sweeper (ongoing during transition):** a periodic job that cancels/abandons orders stuck past a TTL (no driver, dispatch_timeout_at long past) so RESOURCE_EXHAUSTED can never strand a ride again. (Prior finding: late orders were caused by FCM-off + no TTL re-dispatch, not pipeline lag — fold the TTL sweeper in here.)
- **Status vocabulary contract:** the customer app writes `finding_driver`/`searching`; PG pool enums and any `inArray(status, …)` filters must include **every** pool status in lockstep or orders never dispatch. Lock this list down before Phase 1.

## 7. Migration phases

> Each phase is shipped as a **byte-safe additive patch** to the prod bundle (same method as the delivered OTP/PIN/driver-plan patches): verify live hash == known base, append new routes, never modify existing Firestore routes until their PG replacement is proven. Each phase = new tarball + before/after SHA256 + idempotent SQL migration first.

**Phase 0 — PG schema parity (no behavior change).** Diff prod PG vs §3; `ADD COLUMN/TABLE IF NOT EXISTS`. No route changes. Lock the status-vocabulary list.

**Phase 1 — Add the missing PG-backed routes; keep existing app behavior.**
Add (driver-auth, PG-backed, additive): `GET /drivers/:uid/active-orders`, `GET /drivers/me/trips`, `POST /drivers/register-keys`, `POST /orders/:id/{accept,reject,timeout,driver-cancel,complete}`, `PATCH /orders/:id/{stage,location}`, and **driver-capable PG** `GET /orders/:id`. Implement order OTP (§4) and the redispatch/TTL sweeper. These routes write PG-authoritatively and **project to Firestore** (so the still-Firestore customer app keeps working). FK-race guard: ensure parent `orders` row exists before `order_offers` insert; gate FCM on offer-row success. **No mirror-enable flag is turned on.** Net effect: the Driver App's PG calls stop 404-ing → Firestore stops being load-bearing for the driver.

**Phase 2 — Switch Driver App active-ride/stream to VPS (requires explicit approval).**
Stand up `GET /orders/:id/stream` and `GET /drivers/me/offer-stream` reading **PG** (LISTEN/NOTIFY) with the SSE reliability fixes (§5). Point the driver app's streams at PG; remove the Firestore `onSnapshot` fallback path. **Do not enable any mirror/cutover flag without your explicit go-ahead (rule #8).**

**Phase 3 — Switch Customer App track/order reads to VPS.**
Blocked on the §1c Customer App inventory. Add customer-auth PG variants of create/list/detail/stream/cancel/OTP; flip the customer app to them. Keep Firestore projection running until this is verified, then stop projecting.

**Phase 4 — Remove Firestore from the order flow entirely.**
Delete Firestore reads/writes from all order routes; drop the Firestore projection. Keep Firebase **only** for Phone OTP/Auth + FCM. Final verification: no `db2.collection("orders")` remains in the bundle; grep proves it.

## 8–10. Guardrails (carried through every phase)
- No Phase 2/3 mirror or cutover flag enabled without explicit approval.
- OTP-login, driver-plan, and Razorpay/payment routes are untouched; if any order route ever needs a payment field, it will be proven and called out before changing anything.
- Each phase: report → approval → byte-safe patch + idempotent SQL → hashes provided → you deploy. No auto-deploy from here.

---

## Open items needed from you
1. **Customer App source/access** — required to finish §1c and Phase 3.
2. Confirm the authoritative **status vocabulary** list (pool statuses) so §6 contract is locked.
3. Approve which phase to implement first (recommend Phase 0 + Phase 1 together — they are non-breaking and they directly stop the stuck-order class of bug).
