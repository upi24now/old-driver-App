/**
 * withFullScreenOrderAlert — Expo config plugin (Phase 2B)
 *
 * Applied at EAS prebuild time. Performs three sets of modifications:
 *
 *   1. AndroidManifest.xml
 *      • Adds android.permission.USE_FULL_SCREEN_INTENT
 *      • Sets android:showWhenLocked="true" + android:turnScreenOn="true"
 *        on MainActivity so the OS can wake the screen when the
 *        full-screen intent fires.
 *      • Registers FullScreenOrderActionReceiver with ACCEPT and REJECT
 *        broadcast action intent filters.
 *
 *   2. MainApplication.kt
 *      • Imports FullScreenOrderAlertPackage.
 *      • Adds it to getPackages() so React Native's bridge can discover
 *        the module at runtime.
 *
 *   3. File system  (withDangerousMod)
 *      • Copies FullScreenOrderAlertModule.kt, FullScreenOrderAlertPackage.kt,
 *        and FullScreenOrderActionReceiver.kt from android-src/ into the
 *        generated android/app/src/main/java/in/bikecourierservice/driver/.
 *
 * Play-Store policy notes
 * ──────────────────────
 * • USE_FULL_SCREEN_INTENT is granted automatically on Android ≤ 13.
 *   On Android 14+ the user must toggle "Allow display over other apps" for
 *   this app — the existing Screen Wake card in background-setup.tsx drives
 *   them to ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT.
 * • CATEGORY_TRANSPORT is used (not CATEGORY_CALL / CATEGORY_ALARM) which is
 *   the Play-Store-safe category for delivery / courier apps.
 * • No SYSTEM_ALERT_WINDOW permission is used or required.
 */

"use strict";

const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require("@expo/config-plugins");

const fs   = require("fs");
const path = require("path");

const ANDROID_PKG   = "in.bikecourierservice.driver";
const ACTION_ACCEPT = `${ANDROID_PKG}.ACTION_ACCEPT_ORDER`;
const ACTION_REJECT = `${ANDROID_PKG}.ACTION_REJECT_ORDER`;
const PACKAGE_CLASS = "FullScreenOrderAlertPackage";
const FSI_PERM      = "android.permission.USE_FULL_SCREEN_INTENT";

const KOTLIN_FILES = [
  "FullScreenOrderAlertModule.kt",
  "FullScreenOrderAlertPackage.kt",
  "FullScreenOrderActionReceiver.kt",
];

function withFullScreenOrderAlert(config) {
  // ── 1. AndroidManifest modifications ─────────────────────────────────────
  config = withAndroidManifest(config, (mod) => {
    const { manifest } = mod.modResults;

    // 1a. USE_FULL_SCREEN_INTENT permission
    if (!manifest["uses-permission"]) manifest["uses-permission"] = [];
    const perms = manifest["uses-permission"];
    if (!perms.some((p) => p.$["android:name"] === FSI_PERM)) {
      perms.push({ $: { "android:name": FSI_PERM } });
    }

    const app = manifest.application && manifest.application[0];
    if (app) {
      // 1b. showWhenLocked + turnScreenOn on MainActivity
      const activities = app.activity || [];
      const mainActivity = activities.find(
        (a) => a.$ && a.$["android:name"] === ".MainActivity",
      );
      if (mainActivity) {
        mainActivity.$["android:showWhenLocked"] = "true";
        mainActivity.$["android:turnScreenOn"]   = "true";
      } else {
        console.warn(
          "[withFullScreenOrderAlert] MainActivity not found in AndroidManifest — " +
          "showWhenLocked / turnScreenOn not applied.",
        );
      }

      // 1c. Register FullScreenOrderActionReceiver
      if (!app.receiver) app.receiver = [];
      const receivers = app.receiver;
      const alreadyRegistered = receivers.some(
        (r) => r.$ && String(r.$["android:name"]).includes("FullScreenOrderActionReceiver"),
      );
      if (!alreadyRegistered) {
        receivers.push({
          $: {
            "android:name":     ".FullScreenOrderActionReceiver",
            "android:exported": "false",
          },
          "intent-filter": [
            {
              action: [
                { $: { "android:name": ACTION_ACCEPT } },
                { $: { "android:name": ACTION_REJECT } },
              ],
            },
          ],
        });
      }
    }

    return mod;
  });

  // ── 2. MainApplication.kt — import + register the React Native package ────
  config = withMainApplication(config, (mod) => {
    let contents = mod.modResults.contents;

    // Idempotent — skip if the package is already present.
    if (!contents.includes(PACKAGE_CLASS)) {
      // Insert import on a new line immediately after the `package` declaration.
      contents = contents.replace(
        /^(package .+)$/m,
        `$1\n\nimport \`in\`.bikecourierservice.driver.${PACKAGE_CLASS}`,
      );
      // Register inside the getPackages() apply block.
      // The generated MainApplication.kt (SDK 54) contains exactly this string.
      contents = contents.replace(
        "PackageList(this).packages.apply {",
        `PackageList(this).packages.apply {\n      add(${PACKAGE_CLASS}())`,
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });

  // ── 3. Copy Kotlin source files into the generated android project ─────────
  config = withDangerousMod(config, [
    "android",
    (mod) => {
      const projectRoot = mod.modRequest.projectRoot;

      // Source: <projectRoot>/android-src/
      const srcDir = path.join(projectRoot, "android-src");

      // Destination: the package directory inside the generated android/ tree.
      const destDir = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "java",
        "in",
        "bikecourierservice",
        "driver",
      );

      fs.mkdirSync(destDir, { recursive: true });

      for (const file of KOTLIN_FILES) {
        const src  = path.join(srcDir, file);
        const dest = path.join(destDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`[withFullScreenOrderAlert] Copied  ${file}`);
        } else {
          console.warn(
            `[withFullScreenOrderAlert] Source not found: ${src} — ` +
            "the file must exist in android-src/ before running expo prebuild.",
          );
        }
      }

      return mod;
    },
  ]);

  return config;
}

module.exports = withFullScreenOrderAlert;
