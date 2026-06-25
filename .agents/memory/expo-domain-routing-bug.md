---
name: EXPO_PUBLIC_DOMAIN dev vs prod routing bug
description: sisko.replit.dev is internal-only (private IP 172.24.0.5); physical devices must use the deployed .replit.app domain. $REPLIT_DEV_DOMAIN cannot be used as EXPO_PUBLIC_DOMAIN for physical device testing.
---

## The rule

`EXPO_PUBLIC_DOMAIN` in `artifacts/mobile/package.json` `dev` script must be the deployed `.replit.app` domain (e.g. `driver-app-upi24now.replit.app`), NOT `$REPLIT_DEV_DOMAIN`.

**Why:** `$REPLIT_DEV_DOMAIN` (and `$REPLIT_DOMAINS`) resolves to `172.24.0.5` — a private Replit internal proxy IP. Physical Android/iOS devices on an external network cannot route to this IP. `fetch()` in the Expo Go bundle → `TypeError: Network request failed`. The `.replit.app` domain is the publicly-deployed server, reachable from any device.

**Confirmed 2026-06-24:** `curl -v https://$REPLIT_DEV_DOMAIN/api/healthz` inside the Replit container shows `IPv4: 172.24.0.5` and `CN=Replit internal proxy leaf` — a private mTLS proxy. External devices cannot connect.

**How to apply:**
- `package.json` dev script: `EXPO_PUBLIC_DOMAIN=driver-app-upi24now.replit.app` (hardcoded deployed URL)
- `REACT_NATIVE_PACKAGER_HOSTNAME=$REPLIT_DEV_DOMAIN` is correct — Metro itself runs via Expo tunnel, which IS externally accessible
- After adding new API routes to the dev server, you MUST redeploy the API server so the deployed URL serves the new routes
- The diagnostic banner in `login.tsx` shows `DOMAIN=` and `HEALTHZ=` on screen so future bundles can be verified at a glance

## Old (wrong) rule
Previously wrote: "use `$REPLIT_DEV_DOMAIN`". That was wrong — it caused "Network request failed" on physical devices. Do not restore it.

## Production static build: asset-host domain ≠ API domain
**Rule:** the static Expo Go production build (`pnpm run build` → `scripts/build.js`) must keep TWO distinct domains: the asset-host domain (where the JS bundle/assets are served — the Replit deployment host) and the baked API domain (`EXPO_PUBLIC_DOMAIN`, what the running app calls — the VPS `api.bikecourierservice.com`). A release build must NEVER bake a Replit/tunnel host as the API domain (also pin `EXPO_PUBLIC_UPLOAD_DOMAIN` to the API domain so KYC uploads follow).

**Why:** conflating them sent production driver signups/KYC/fees to the Replit api-server, invisible to the Admin Panel (which reads the VPS). Dev (`pnpm run dev`) is unaffected (runs `expo start` directly); the EAS `production` profile was already correct — only the static build conflated them.

## EAS profiles: every release/distributed profile must pin the prod API
**Rule:** in `eas.json`, both `preview` and `production` (any `distribution: internal`/release profile that ships to testers/drivers) must set `EXPO_PUBLIC_DOMAIN`+`EXPO_PUBLIC_UPLOAD_DOMAIN` = `api.bikecourierservice.com`. Only the `development` (`developmentClient: true`) profile may keep a Replit host, since it loads JS from Metro and is never distributed externally. Confirmed 2026-06-25: `preview` had been left on the stale `driver-app-upi24now.replit.app` while `production` was already correct.

**Verify a baked build cheaply:** `EXPO_PUBLIC_DOMAIN=api.bikecourierservice.com pnpm exec expo export --platform android --output-dir <dir>` then `grep -a` the emitted `_expo/static/js/android/*.hbc` — Hermes keeps string literals as ASCII, so the only baked `/api` URL must be `https://api.bikecourierservice.com/api` and there must be 0 replit/ngrok/trycloudflare matches. (`exp.host`/`exp.direct` hits are Expo's own push-relay/tunnel constants from node_modules, not the app's API target — ignore them.)

**Note:** KYC status route is `GET /api/drivers/verification-status` (token-derived uid); there is NO `/api/drivers/<uid>/kyc-status`.

## Consequence for Tier-6 SSE routes
The SSE routes (`/api/drivers/me/offer-stream`, `/api/orders/:id/stream`) are dev-only until the API server is (re)deployed. Physical device SSE will get 404 until deployment. Keep Firestore fallback in DriverContext or deploy before testing SSE on device.
