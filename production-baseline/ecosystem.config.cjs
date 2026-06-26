// PM2 process definition for the Bike Courier API (Phase 1 bundle).
//
// The app loads its own .env (bundled loadEnv) — it looks for `.env` in THIS
// directory (next to this file), then dist/.env, then cwd/.env. No
// `-r dotenv/config` flag is needed.
//
// Deploy:  pm2 startOrReload ecosystem.config.cjs --update-env
//
// IMPORTANT (Phase 1): this bundle CONTAINS the Firestore->PostgreSQL mirror
// worker but it stays OFF unless MIRROR_ENABLED=true. Do NOT set MIRROR_ENABLED
// here for the deploy step — enabling the mirror is a SEPARATE, explicitly
// approved action (see phase1-mirror-on-runbook.md). Deploying this package
// alone changes NO behavior.
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
