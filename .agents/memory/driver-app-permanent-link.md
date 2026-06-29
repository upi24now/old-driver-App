---
name: Driver App permanent link (Expo Go static deploy)
description: How the permanent driver-app-upi24now.replit.app link works and why it avoids the dev-domain DNS failure.
---

# Driver App permanent link

The permanent link `https://driver-app-upi24now.replit.app` is a Replit **autoscale deployment** of the Expo `mobile` artifact. It is NOT a browser web app — it serves a production-minified **Expo Go static bundle** (per-platform `manifest.json` + `bundle.js`) via `artifacts/mobile/server/serve.js`. Browsers hitting `/` get a landing page; Expo Go hitting `/` with an `expo-platform` header gets the manifest, then downloads the bundle. Drivers open the link in Expo Go.

**Why this link instead of the dev Expo domain:** mobile-carrier DNS in India returned `DNS_PROBE_FINISHED_NXDOMAIN` for the nested dev host `<id>.expo.sisko.replit.dev` (extra label trips carrier resolvers), and ngrok (`exp.direct`) was down. The flat `.replit.app` deployment domain resolves everywhere, so it is the reliable distribution channel while keeping Expo Go (no APK build).

**API base is force-pinned, not env-driven:** `artifacts/mobile/scripts/build.js` `getApiDomain()` hardcodes `PRODUCTION_API_DOMAIN = "api.bikecourierservice.com"` and rejects any Replit/tunnel host. So the deployed bundle ALWAYS calls the VPS API regardless of `EXPO_PUBLIC_DOMAIN` (which only sets the asset host). Do not try to fix API routing via `EXPO_PUBLIC_DOMAIN` for production builds.

**Verifying a publish is the latest source:** a module-level `console.log("[BUILD_CHECK] …")` in `app/_layout.tsx` prints once at bundle eval. No `babel-plugin-transform-remove-console` is configured, so `console.log` survives the `--no-dev --minify` build. After publishing, `curl` the served android `bundle.js` and grep for the BUILD_CHECK string and the `lat`/`lng` location payload to prove the live bundle is current.

**Publishing is user-initiated** (suggest_deploy prompts; the user clicks Publish). The agent cannot trigger the actual deploy, so post-publish verification (curl+grep of the live bundle) is the proof step.
