// PM2 process definition for the Bike Courier API (driver order-lifecycle patch).
//
// The app loads its own .env (bundled loadEnv) — it looks for `.env` in THIS
// directory (next to this file), then dist/.env, then cwd/.env. No
// `-r dotenv/config` flag is needed.
//
// Deploy:  pm2 startOrReload ecosystem.config.cjs --update-env
//
// This bundle is the driver-plan patch (dedff18a) + ONE additive block of 11
// PG-only driver order-lifecycle routes. It still CONTAINS the Phase 1
// Firestore->PostgreSQL mirror worker but it stays OFF unless MIRROR_ENABLED=true.
// Do NOT set MIRROR_ENABLED here. Deploying this package alone changes NO behavior
// until orders exist in PG (the new READ routes return a JSON miss so the app keeps
// its existing Firestore fallback).
const path = require("path");

module.exports = {
  apps: [
    {
      name: "bike-courier-api",
      script: "dist/production-api.js",
      cwd: __dirname, // ensures .env next to this file is found
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: "3000", // change here (or set PORT in .env) to match nginx upstream
        // MIRROR_ENABLED intentionally NOT set here -> defaults OFF.
      },
    },
  ],
};
