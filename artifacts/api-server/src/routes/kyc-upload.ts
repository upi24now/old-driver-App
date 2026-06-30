/**
 * kyc-upload.ts
 *
 * POST /api/kyc/upload
 *
 * Accepts a multipart/form-data upload from the mobile app.
 * Authenticates with a Firebase ID token, saves the file to local disk,
 * and returns a publicly accessible download URL.
 *
 * No Firebase Storage is used — files are stored on the VPS filesystem.
 *
 * Fields (multipart):
 *   file           — image file (required)
 *   uid            — driver UID (must match the token's uid)
 *   documentType   — one of the ALLOWED_DOC_TYPES values (required)
 *
 * Storage layout on disk:
 *   <UPLOADS_DIR>/kyc/<uid>/<documentType>.jpg
 *
 * Download URL returned:
 *   <API_PUBLIC_URL>/uploads/kyc/<uid>/<documentType>.jpg
 *
 * Environment (read at request time, not at module init, so dotenv values work):
 *   UPLOADS_DIR    — absolute path to uploads root
 *                    (default: <bundle-dir>/../uploads, pinned in index.ts)
 *   API_PUBLIC_URL — public base URL of this server
 *                    (e.g. https://api.bikecourierservice.com)
 *                    Falls back to https://<Host header> when not set.
 */

import { Router } from "express";
import multer, { type FileFilterCallback } from "multer";
import path from "path";
import fs from "fs";
import type { Request } from "express";
import { adminAuth } from "../lib/firebase-admin";
import { isDriverVerificationLocked, DOCUMENTS_LOCKED_MESSAGE } from "../lib/kyc-lock";

const router = Router();

const ALLOWED_DOC_TYPES = new Set([
  "selfie",
  "aadhaarFront",
  "aadhaarBack",
  "pan",
  "licenseFront",
  "licenseBack",
  "rcFront",
  "rcBack",
  // legacy aliases — kept for backward compatibility
  "aadhaar",
  "license",
  "rc",
  "insurance",
]);

// ─── Resolve uploads dir at request time ──────────────────────────────────────
// Reading process.env inside the callbacks (not at module init) ensures that
// the value pinned by index.ts (process.env["UPLOADS_DIR"] = uploadsDir) is
// visible here, regardless of module load order.

function getUploadsDir(): string {
  return process.env["UPLOADS_DIR"] ?? path.join(process.cwd(), "uploads");
}

// ─── Multer disk storage ──────────────────────────────────────────────────────

const diskStorage = multer.diskStorage({
  destination(req: Request, _file, cb) {
    const { uid } = req.body as { uid?: string };
    if (!uid) {
      cb(new Error("uid is required"), "");
      return;
    }
    const dir = path.join(getUploadsDir(), "kyc", uid);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },

  filename(req: Request, _file, cb) {
    const { documentType } = req.body as { documentType?: string };
    if (!documentType || !ALLOWED_DOC_TYPES.has(documentType)) {
      cb(
        new Error(
          `Invalid or missing documentType. Must be one of: ${[...ALLOWED_DOC_TYPES]
            .filter((t) => !["aadhaar", "license", "rc", "insurance"].includes(t))
            .join(", ")}`,
        ),
        "",
      );
      return;
    }
    cb(null, `${documentType}.jpg`);
  },
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are accepted"));
  }
}

const upload = multer({
  storage:  diskStorage,
  fileFilter,
  limits:   { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/kyc/upload
 *
 * multipart/form-data fields:
 *   file           — image
 *   uid            — driver UID
 *   documentType   — selfie | aadhaarFront | aadhaarBack | pan |
 *                    licenseFront | licenseBack | rcFront | rcBack
 *
 * Headers:
 *   Authorization: Bearer <Firebase ID token>
 *
 * Response 200: { ok: true;  url: string }
 * Response 400: { ok: false; error: string }
 * Response 401: { ok: false; error: string }
 * Response 403: { ok: false; error: string }
 * Response 500: { ok: false; error: string }
 */
router.post("/kyc/upload",
  // Step 0 — lock gate. Runs BEFORE multer so a verified driver's existing file
  // on disk is never overwritten. Uses the token's uid (header), independent of
  // the multipart body. On any token/lookup failure we fall through and let the
  // existing handler return the correct 401 — we only hard-block confirmed locks.
  async (req, res, next) => {
    try {
      const authHeader  = req.headers["authorization"] ?? "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      if (!bearerToken) { next(); return; }
      const auth    = await adminAuth();
      const decoded = await auth.verifyIdToken(bearerToken);
      if (await isDriverVerificationLocked(decoded.uid)) {
        req.log.warn({ uid: decoded.uid }, "kyc/upload blocked — documents locked after verification");
        res.status(403).json({ ok: false, error: "documents_locked", message: DOCUMENTS_LOCKED_MESSAGE });
        return;
      }
      next();
    } catch {
      // Token invalid/expired or lookup failed — defer to the main handler's
      // existing 401 path; never let a verified-lock check swallow that.
      next();
    }
  },

  // Step 1 — parse the multipart body
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        req.log.warn({ err: err instanceof Error ? err.message : err }, "kyc/upload multer error");
        res.status(400).json({ ok: false, error: err instanceof Error ? err.message : "Upload error." });
        return;
      }
      next();
    });
  },

  // Step 2 — auth + validation + response
  async (req, res) => {
    // ── 1. Verify Bearer token ──────────────────────────────────────────────
    const authHeader  = req.headers["authorization"] ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    req.log.info(
      { headerPresent: !!authHeader, tokenPresent: !!bearerToken, tokenLength: bearerToken.length },
      "[SERVER_AUTH_HEADER_PRESENT]",
    );

    if (!bearerToken) {
      res.status(401).json({ ok: false, error: "Authorization header with Bearer token is required." });
      return;
    }

    // Decode JWT payload WITHOUT verification so we can log aud/iss/exp
    // regardless of whether verifyIdToken succeeds or fails.
    function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
      try {
        const part = jwt.split(".")[1];
        if (!part) return null;
        const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
        return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
      } catch { return null; }
    }

    const jwtPayload = decodeJwtPayload(bearerToken);
    req.log.info(
      {
        tokenAud:              jwtPayload?.["aud"]  ?? "(could not decode)",
        tokenIss:              jwtPayload?.["iss"]  ?? "(could not decode)",
        tokenExp:              jwtPayload?.["exp"]  ?? "(could not decode)",
        tokenExpHuman:         jwtPayload?.["exp"]
          ? new Date((jwtPayload["exp"] as number) * 1000).toISOString()
          : "(could not decode)",
        serverExpectedProject: process.env["FIREBASE_PROJECT_ID"] ?? "(not set)",
      },
      "[SERVER_TOKEN_DECODED_UNVERIFIED]",
    );

    let tokenUid: string;
    try {
      const auth    = await adminAuth();
      const decoded = await auth.verifyIdToken(bearerToken);
      tokenUid = decoded.uid;
      req.log.info({ tokenUid }, "[SERVER_VERIFY_TOKEN_OK]");
    } catch (err) {
      const e = err as Error & { code?: string };
      req.log.warn(
        {
          code:                  e?.code,
          message:               e?.message,
          name:                  e?.name,
          serverExpectedProject: process.env["FIREBASE_PROJECT_ID"] ?? "(not set)",
          tokenAud:              jwtPayload?.["aud"] ?? "(could not decode)",
          tokenIss:              jwtPayload?.["iss"] ?? "(could not decode)",
        },
        "[SERVER_VERIFY_TOKEN_FAIL]",
      );
      res.status(401).json({ ok: false, error: "Invalid or expired token." });
      return;
    }

    // ── 2. Validate body fields ─────────────────────────────────────────────
    const { uid, documentType } = req.body as { uid?: string; documentType?: string };

    if (!uid) {
      res.status(400).json({ ok: false, error: "uid is required." });
      return;
    }
    if (!documentType || !ALLOWED_DOC_TYPES.has(documentType)) {
      res.status(400).json({
        ok: false,
        error: `Invalid or missing documentType. Must be one of: selfie, aadhaarFront, aadhaarBack, pan, licenseFront, licenseBack, rcFront, rcBack.`,
      });
      return;
    }

    // ── 3. Ensure token uid matches body uid ────────────────────────────────
    if (tokenUid !== uid) {
      req.log.warn({ tokenUid, uid }, "kyc/upload: uid mismatch");
      res.status(403).json({ ok: false, error: "Token UID does not match the supplied uid." });
      return;
    }

    // ── 4. Confirm file was received ────────────────────────────────────────
    const file = req.file;
    if (!file) {
      res.status(400).json({ ok: false, error: "No file received. Send image as multipart field named 'file'." });
      return;
    }

    req.log.info(
      {
        uid,
        documentType,
        size:     file.size,
        mimetype: file.mimetype,
        path:     file.path,
      },
      "[KYC_UPLOAD_FILE_SAVED]",
    );

    // ── 5. Build public download URL ────────────────────────────────────────
    //
    // API_PUBLIC_URL should be the canonical public base URL of this server,
    // e.g. https://api.bikecourierservice.com in production.
    // Files are served at /uploads/kyc/<uid>/<documentType>.jpg
    // (mounted via app.use("/uploads", express.static(UPLOADS_DIR))).
    const publicBase =
      process.env["API_PUBLIC_URL"] ??
      `${req.protocol}://${req.headers["host"] ?? "localhost"}`;

    const downloadURL = `${publicBase}/uploads/kyc/${uid}/${documentType}.jpg`;

    res.status(200).json({ ok: true, url: downloadURL });
  },
);

export default router;
