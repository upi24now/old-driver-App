---
name: Expo Go static deploy serves the last publish-snapshot commit
description: Why a committed mobile fix can stay invisible on the live Expo Go static deploy, and how to diagnose it.
---

# Expo Go static deploy = builds from the last "Published your App" git snapshot

The Driver App live URL (`driver-app-upi24now.replit.app`) is a Replit **autoscale** deploy of an Expo Go **static** bundle. `artifacts/mobile/scripts/build.js` exports the bundle and bakes a fresh `timestamp = \`${Date.now()}-${pid}\``; the manifest `createdAt` and `launchAsset.key = bundle-<timestamp>` come straight from that build-time `Date.now()`. `static-build/` is **NOT** committed to git (generated at deploy time).

**The trap:** the deploy builds from the git snapshot captured at publish time — each publish creates a `Published your App` commit. A fix committed *after* the most recent `Published your App` commit is **not live**, no matter how many times you "redeploy/promote" — promoting re-serves the existing build. The live bundle's `createdAt` will not advance.

**Why:** "republish" in the UI can re-promote the existing build instead of snapshotting current HEAD; and the publish snapshot is a real commit, so its position in `git log` is the source of truth.

**How to diagnose a "my fix isn't live" mobile report:**
1. `git log --oneline` — find the newest `Published your App` commit. If the user's fix commit is *above* it (newer), the fix was never in a deployed snapshot. Compare commit dates with `git show -s --format=%ci`.
2. Fetch the live manifest: `curl -H "expo-platform: android" https://<host>/` → read `createdAt` + `launchAsset.key`. `createdAt` is the build wall-clock. If it predates the fix commit time, no build ran after the fix.
3. Grep the **served bundle** (download `launchAsset.url`) for ground truth — string literals (e.g. UI text) survive minification; numeric consts get minified (`10000`→`1e4`, `30000`→`3e4`). The heartbeat interval shows as `intervalMs:1e4` and the `setInterval(...,1e4)` closing delay.
4. Fix = a genuinely new publish that snapshots current HEAD (creates a `Published your App` commit *above* the fix). After it, re-fetch manifest and confirm `createdAt`/build-id advanced before grepping content. The agent cannot click Publish; the user triggers it.
