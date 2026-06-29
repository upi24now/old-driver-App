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

# Root cause to fix
Live prod VPS `GET /api/drivers/me` is gated behind an admin-access check and rejects a normal driver's own token with 403. PIN system (verify-otp/set-pin/verify-pin) is fine.
