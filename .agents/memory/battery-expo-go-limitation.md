---
name: Battery optimization — Expo Go limitation
description: Why exact battery settings intent cannot work in Expo Go, and what the accepted final behavior is.
---

## Rule

Battery optimization intent (A: `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) will always fail in Expo Go. This is a known, accepted limitation — not a code bug. Do not attempt to fix it further for Expo Go.

## Why

Expo Go runs as `host.exp.exponent`. Our `app.json` Android permissions (including `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) only apply to production/dev builds compiled under `in.bikecourierservice.driver`. Expo Go's own manifest does not declare that permission, so the intent throws `SecurityException` at runtime regardless of what we put in `app.json`.

## Accepted final behavior

- Battery row always shows "Action required" — never fake ✅
- Battery excluded from `allOk` — never blocks duty ON or dashboard
- Fix tap → instruction modal → Continue tries the 4-level fallback:
  - A: `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (works in prod APK)
  - B: `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` (works on stock Android)
  - C: `Linking.openSettings()` (opens current app's App Info — Expo Go or prod)
  - D: `Alert` with manual Hindi instructions
- In Expo Go, path C or D is the expected outcome — that is correct, not a failure.

## Production path

`app.json` already includes `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. In a real APK/dev build under `in.bikecourierservice.driver`, intent A will succeed and open the direct battery dialog.

**How to apply:** Any future session touching battery optimization UI should treat "Continue doesn't open exact battery screen in Expo Go" as expected, not a regression to fix.
