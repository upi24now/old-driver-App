const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

/**
 * pnpm workspace symlinks are not created in this environment (pnpm install is
 * blocked by the package firewall for a transitive dep).  babel-preset-expo is
 * installed at the workspace root and calls hasModule('expo-router') using
 * Node's require.resolve() from that location.  Because expo-router only lives
 * in artifacts/mobile/node_modules/, the check returns false → expoRouterBabelPlugin
 * is never registered → process.env.EXPO_ROUTER_APP_ROOT is never inlined →
 * Metro's collect-dependencies throws "Invalid call: process.env.EXPO_ROUTER_APP_ROOT".
 *
 * Fix: create the missing symlink at metro startup (before transform workers spawn).
 */
const workspaceRoot = path.resolve(__dirname, "../..");
const mobileModules = path.resolve(__dirname, "node_modules");

for (const pkg of ["expo-router"]) {
  const target = path.join(mobileModules, pkg);
  const link = path.join(workspaceRoot, "node_modules", pkg);
  if (fs.existsSync(target) && !fs.existsSync(link)) {
    try {
      fs.symlinkSync(target, link, "junction");
      console.log(`[metro.config] symlinked ${pkg} → workspace root node_modules`);
    } catch (_) {
      // Already exists or permission error — not fatal
    }
  }
}

module.exports = getDefaultConfig(__dirname);
