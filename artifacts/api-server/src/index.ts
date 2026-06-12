// Load .env using an explicit path derived from the bundle's own location so
// this works regardless of PM2's cwd setting.
// The bundle lands in dist/index.mjs; .env sits one level up at the project root.
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env") });

import app from "./app";
import { logger } from "./lib/logger";
import { startFcmDispatcher } from "./lib/fcm-dispatcher";
import { startRoundRobinDispatcher } from "./lib/round-robin-dispatcher";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start the Firestore → FCM order dispatcher (fire-and-forget; errors logged internally)
  startFcmDispatcher().catch((e) =>
    logger.error({ err: e }, "FCM dispatcher startup failed"),
  );

  // Start the round-robin driver dispatch loop (fire-and-forget; errors logged internally)
  startRoundRobinDispatcher().catch((e) =>
    logger.error({ err: e }, "Round-robin dispatcher startup failed"),
  );
});
