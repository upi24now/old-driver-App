import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const UPLOADS_DIR = process.env["UPLOADS_DIR"] ?? path.join(process.cwd(), "uploads");
// Ensure uploads root exists at startup (no-op if already present)
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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

// Serve uploaded KYC files at /api/uploads/kyc/<uid>/<docId>.jpg
// Mounted under /api so the Replit proxy (which only exposes /api) can serve them.
// In production on your VPS, the same path works since the server handles all routes.
app.use("/api/uploads", express.static(path.join(UPLOADS_DIR), {
  index:   false,   // no directory listings
  maxAge:  "7d",
}));

export default app;
