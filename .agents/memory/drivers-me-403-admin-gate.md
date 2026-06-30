---
name: /drivers/me 403 admin-gate blocks PIN login
description: Why "PIN rejected / bounces to login" on prod is actually a /drivers/me 403, not a PIN-persistence bug.
---

# Symptom
Driver completes verify-otp → create-PIN → presses Continue → app returns to Login; user concludes "PIN rejected / not saved" and a dev/Replit-replica DB query shows has_pin=false.

# What the device trace actually proves (real run, phone 8299013350)
- verify-otp → 200
- set-pin → **200** `{ok,sessionId}` (PIN IS sent and persisted)
- verify-pin → **200 SUCCESS** immediately after (independent proof the PIN hash persisted on the LIVE VPS DB)
- **GET /api/drivers/me → 403 `{"error":"Forbidden — account does not have admin access"}`** ← first failing step
- confirmPin returns ok:false → isOtpVerified never set true → route guard `[GUARD] REDIRECT → /login reason=otp_required` (NOT SESSION_REPLACED — that handler never fires)

# Two durable lessons
1. **Replit "production" replica ≠ the live VPS database.** has_pin=false on the Replit replica is meaningless for this app; the live VPS DB is authoritative. Confirm PIN persistence via verify-pin 200, not a replica SELECT.
2. **Frontend treats any non-404 /drivers/me error as fatal** (`DriverContext.tsx` OTP_PROFILE_GATE: "source ≠ 404 — skipping ensureDriverSignup"), so a 403 from the profile endpoint silently bounces the user to /login and looks like "PIN rejected".

# Root cause (mechanism)
The bundle's drivers router has NO `/me` route, so `GET /api/drivers/me` falls through to `router.get("/:uid", adminAuth, ...)` with `:uid="me"`; `adminAuth` verifies the token fine then 403s the non-admin driver. PIN system (verify-otp/set-pin/verify-pin) is fine.

# Fix (shipped)
Additive prod-bundle patch `production-baseline/driver-me-route-restore/` inserts a top-level `app.get("/api/drivers/me", ...)` BEFORE `app.use("/api", routes_default)` so it wins over the admin `/:uid` route. Auth via `auth.verifyIdToken` (401 not 403), PG-authoritative read of drivers+driver_documents, returns PgDriverProfile shape with server-computed onboardingStep/nextRoute. Known deviations from canonical: omits the optional Firestore→PG verification heal (PG-only) and does NOT enforce single-device `x-session-id` on this read (avoids re-introducing a bounce). Same anchor-splice/byte-safe/idempotent pattern as the auth-routes restore; both compose (insert before same anchor, 0 deletions).
