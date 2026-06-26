// PM2 process definition for the Bike Courier API (single-device login patch).
//
// The app loads its own .env (bundled loadEnv) — it looks for `.env` in THIS
// directory (next to this file), then dist/.env, then cwd/.env. No
// `-r dotenv/config` flag is needed.
//
// Deploy:  pm2 startOrReload ecosystem.config.cjs --update-env
//
// This bundle is the driver-orders patch (395ffcb2) + ONE additive block adding
// single-device login (PIN-primary auth, OTP 3/24h rate limit, x-session-id
// enforcement on the order-lifecycle auth gate). No new env vars are required.
// Existing sessions are unaffected until the next successful login claims a device.
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
      },
    },
  ],
};
