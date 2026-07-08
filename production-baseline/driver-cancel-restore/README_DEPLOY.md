# Driver-cancel route restore

## Root cause (confirmed via direct inspection of the live bundle, not guessed)

The live `api-pkg/dist/production-api.js` on the VPS has:
- `PATCH /api/orders/:orderId/stage` — present
- `POST /api/orders/:orderId/accept` — present
- `POST /api/orders/:orderId/driver-cancel` — **missing entirely**

The mobile app's `driverCancelOrder()` calls `POST /orders/:orderId/driver-cancel`
with a bearer token and `{ reason }` body. Since the route was never added to
the live bundle, every call falls through to the bundle's catch-all
`app.use("/api", routes_default)` and returns 404. This is a backend gap, not
a mobile-app bug — confirmed by grepping the live bundle for the route path
and finding no match, while the sibling `accept`/`stage` routes do exist.

Facts confirmed directly from the live bundle before writing this patch:
- Route param convention: `:orderId` (not `:id`)
- `driverAuth` middleware exists and sets `req.driverUid` from the verified
  Firebase ID token
- `orders` is a Postgres table (raw SQL via the module-scope `pool`, not an
  ORM), with columns including `id`, `status`, `driver_uid`,
  `active_offer_driver_uids` (jsonb), `raw` (jsonb), `updated_at`
- Order status vocabulary confirmed present: `pending`, `accepted`,
  `finding_driver`, `dispatched`
- The `app.use("/api", routes_default);` anchor is a unique real statement in
  the bundle (a second textual match is inside a comment without the trailing
  semicolon, so matching with the semicolon is unambiguous)

## What this patch adds

Exactly one route, additively, immediately before
`app.use("/api", routes_default)` (same splice point convention as prior
route restores in `production-baseline/`):

```
POST /api/orders/:orderId/driver-cancel
```

Behavior: verifies the caller via `driverAuth`, and — only while the order's
`status = 'accepted'` and `driver_uid` matches the caller — atomically
returns the order to the pool (`status = 'finding_driver'`, clears
`driver_uid` and `active_offer_driver_uids`, stamps cancel metadata into the
`raw` jsonb column). Responses: `200 {ok:true}` only when it just performed
that transition, `403 forbidden` if the order belongs to a different driver,
`404 not_found` if the order doesn't exist, `409 too_late` for any other
status on an order still owned by this driver (already back in the pool,
already delivered, etc. — this is intentionally NOT reported as success, to
keep `200` mean exactly "just cancelled it"), `500` on DB error.

Note: this route is registered directly on the bare `app` (like its
`accept`/`stage` siblings), so its own path includes the `/api` prefix
literally — it is `app.post("/api/orders/:orderId/driver-cancel", ...)`, not
`app.post("/orders/:orderId/driver-cancel", ...)`.

**Scope note (not a guess, a documented limitation):** cancellation is only
enabled while `status = 'accepted'`, the one status value directly confirmed
in the live bundle for "driver accepted, pre-pickup". If your delivery flow
also needs driver-cancel to work from additional en-route statuses, those
literal status strings need to be confirmed from the live bundle first (grep
for them) and added to `CANCELLABLE_STATUSES` in
`driver-cancel-route-body.js` — do not guess them in.

Zero existing routes are touched, modified, or removed.

## Deploy steps

1. Copy this folder (`driver-cancel-route-body.js` and
   `apply-driver-cancel-patch.cjs`) onto the VPS, next to `api-pkg/` (or
   anywhere — the script auto-locates `dist/production-api.js`, or pass the
   path explicitly).
2. From inside `api-pkg/`, run:
   ```
   node /path/to/apply-driver-cancel-patch.cjs
   ```
   It will:
   - Abort with a clear message and make NO changes if the anchor isn't found
     exactly once, or if `pool`, `driverAuth`, or `active_offer_driver_uids`
     aren't found (i.e. if the bundle has drifted further since this was
     written).
   - Otherwise write a timestamped `.bak.driver-cancel.<stamp>` backup, patch
     `dist/production-api.js` in place, and print BASE/PATCHED sha256 plus a
     byte-safety confirmation (removing the inserted block reproduces the
     original byte-for-byte).
3. Verify syntax before restarting the process:
   ```
   node --check dist/production-api.js
   ```
4. Restart the API process (e.g. `pm2 restart bike-courier-api`).
5. Smoke test:
   ```
   curl -i -X POST https://api.bikecourierservice.com/api/orders/doesnotexist/driver-cancel
   ```
   Expect `401 Unauthorized` (no token) — NOT `404` (404 would mean the patch
   didn't take effect). With a real driver's bearer token and an order they
   currently have `accepted`, expect `200 {"ok":true}` and the order to
   reappear in the dispatch pool.

## Rollback

```
cp dist/production-api.js.bak.driver-cancel.<stamp> dist/production-api.js
pm2 restart bike-courier-api
```
