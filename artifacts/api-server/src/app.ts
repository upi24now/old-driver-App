import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

/**
 * Mount the static uploads route.
 * Called from index.ts AFTER dotenv has been loaded so that
 * process.env["UPLOADS_DIR"] is already populated before this runs.
 *
 * Files are served at /uploads/kyc/<uid>/<documentType>.jpg
 * which maps to <UPLOADS_DIR>/kyc/<uid>/<documentType>.jpg on disk.
 *
 * On the VPS, Nginx (or the process itself) routes /uploads/* to Express.
 * In Replit dev, use /api/kyc/upload for uploading; static serving of
 * /uploads/* requires direct VPS access or a proxy rule for local testing.
 */
export function initStaticUploads(uploadsDir: string): void {
  fs.mkdirSync(uploadsDir, { recursive: true });
  app.use("/uploads", express.static(uploadsDir, {
    index:  false,   // no directory listings
    maxAge: "7d",
  }));
}

export default app;
