---
name: Expo dev link on Replit (no ngrok)
description: How to serve the Expo dev server / generate a working Expo Go link on Replit without the ngrok tunnel.
---

# Expo dev link on Replit without ngrok

`expo start --tunnel` routes Metro through **ngrok**. During an ngrok outage it fails hard
with `CommandError: failed to start tunnel / remote gone away` and NO link can be produced.

**Replit has a native, ngrok-free path**: the mobile artifact uses `router = "expo-domain"`
and exposes Metro on `$REPLIT_EXPO_DEV_DOMAIN` (the `*.expo.sisko.replit.dev` host) over 443.

**Why the naive fixes fail:** removing `--tunnel` alone still makes Metro advertise the bundle
at `host:PORT` (e.g. `:18115`). Replit only exposes 80/443 publicly, so the manifest loads but
the JS bundle download fails (HTTP 000) and the app never starts. Setting
`REACT_NATIVE_PACKAGER_HOSTNAME=$REPLIT_EXPO_DEV_DOMAIN` still appends `:PORT`, also unreachable.

**Working dev script (canonical Replit Expo):**
`EXPO_PACKAGER_PROXY_URL=https://$REPLIT_EXPO_DEV_DOMAIN ... REACT_NATIVE_PACKAGER_HOSTNAME=$REPLIT_DEV_DOMAIN pnpm exec expo start --localhost --port $PORT`

`EXPO_PACKAGER_PROXY_URL` makes Metro advertise the **clean, port-less** proxy URL; `--localhost`
replaces `--tunnel`.

**How to apply / verify:** after restart, fetch the manifest with header `expo-platform: android`
from `https://$REPLIT_EXPO_DEV_DOMAIN/` and confirm the `launchAsset.url` has **no `:PORT`**, then
`curl` that exact URL and expect `HTTP 200` (multi-MB). The Expo Go link to give the user is
`exp://$REPLIT_EXPO_DEV_DOMAIN` (no port). Standalone release APKs cannot use any Metro link;
only Expo Go / dev-client builds can.
