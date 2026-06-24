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

## Consequence for Tier-6 SSE routes
The SSE routes (`/api/drivers/me/offer-stream`, `/api/orders/:id/stream`) are dev-only until the API server is (re)deployed. Physical device SSE will get 404 until deployment. Keep Firestore fallback in DriverContext or deploy before testing SSE on device.
