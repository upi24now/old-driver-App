---
name: Android native splash/icon source of truth
description: Where the Android 12 system splash + launcher icon actually come from in this Expo app, and why a stale gitignored android/ ships the wrong branding.
---

# Android native splash & launcher icon (Bike Courier mobile)

The **native Android 12 system splash** (the frame that appears BEFORE the JS `AnimatedSplash`) is NOT controlled by `app.json` at build time in this repo's shipping path. It is controlled by the generated native resources in `artifacts/mobile/android/`:
- `android/.../res/values/styles.xml` → `Theme.App.SplashScreen` → `windowSplashScreenBackground=@color/splashscreen_background`, `windowSplashScreenAnimatedIcon=@drawable/splashscreen_logo`, `windowSplashScreenBehavior=icon_preferred`.
- `android/.../res/values/colors.xml` → `splashscreen_background` (the bg color) and `iconBackground`.
- `android/.../res/drawable-*/splashscreen_logo.png` (5 densities) → the splash logo.
- Launcher icon = `mipmap-*/ic_launcher.webp` (legacy; `mipmap-anydpi-v26` is EMPTY here so no adaptive XML is used). `ic_launcher_foreground.webp` exists but is unused without anydpi.

**Why the wrong (Expo template blue-"A" on white) splash shipped:** `android/` is **gitignored** (CNG/managed pattern) and regeneratable, but `.easignore` does **NOT** exclude it. With `EAS_NO_VCS`, EAS archives the working dir minus `.easignore`, so the local `android/` IS uploaded → EAS treats the project as **bare and SKIPS prebuild** → it ships whatever stale resources are in `android/`. The stale dir was generated when `app.json.splash` still pointed at the template `icon.png` and bg was white. So editing `app.json` alone does nothing for the shipped build.

**Two correct fixes:**
1. (Used) Edit the generated `android/` resources directly — fully verifiable locally and ships exactly what you verify. Match the EXISTING pixel dimensions (`magick identify`) when regenerating, and recolor `splashscreen_background`/`iconBackground`. ImageMagick (`magick`) is available; `sharp` is NOT resolvable from `/tmp`.
2. (Alternative, intended CNG flow) Add `android/`+`ios/` to `.easignore` and delete local `android/` so EAS runs a clean prebuild from `app.json` + config plugins.

**Why edit android/ here:** `expo prebuild` is **blocked locally** — it touches `.git/index.lock`, which the Replit main-agent sandbox forbids ("Destructive git operations are not allowed"). So you cannot regenerate `android/` locally; edit it directly or rely on server-side EAS prebuild.

**Durability caveat:** because `android/` is gitignored, hand-edited native resources are lost on a fresh clone / `expo prebuild --clean`. Keep `app.json` correct (it's the prebuild source of truth) so a future prebuild also produces brand assets.

**Dispatch safety:** the full-screen-intent (FSI) dispatch feature lives in the same `android/` (manifest `showWhenLocked`/`turnScreenOn`/`FullScreenOrderActionReceiver`/`USE_FULL_SCREEN_INTENT` + `FullScreenOrderAlert*.kt`). Touch ONLY colors.xml + splash/launcher images; never the manifest/kotlin/gradle. A fresh prebuild re-applies FSI via the `withFullScreenOrderAlert` plugin (`plugins/` + `android-src/`).
