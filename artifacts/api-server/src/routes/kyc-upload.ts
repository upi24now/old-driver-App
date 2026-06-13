/**
 * kyc-upload.ts
 *
 * POST /api/kyc/upload
 *
 * Accepts a multipart/form-data upload from the mobile app.
 * Authenticates with a Firebase ID token, saves the file to disk,
 * and returns a publicly accessible download URL.
 *
 * Fields (multipart):
 *   file   — image file (required)
 *   uid    — driver UID (must match the token's uid)
 *   docId  — document slot: selfie | aadhaar | pan | license | rc | insurance
 *
 * Storage layout on disk:
 *   <UPLOADS_DIR>/kyc/<uid>/<docId>.jpg
 *
 * Download URL returned:
 *   <API_PUBLIC_URL>/api/uploads/kyc/<uid>/<docId>.jpg
 *
 * Environment (read at request time, not at module init, so dotenv values work):
 *   UPLOADS_DIR    — absolute path to uploads root
 *                    (default: <bundle-dir>/../uploads)
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

const router = Router();

const ALLOWED_DOC_IDS = new Set(["selfie", "aadhaar", "pan", "license", "rc", "insurance"]);

// ─── Resolve uploads dir at request time ──────────────────────────────────────
// Reading process.env inside the callbacks (not at module init) ensures that
// the value loaded by dotenv in index.ts is visible here.

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
    const { docId } = req.body as { docId?: string };
    if (!docId || !ALLOWED_DOC_IDS.has(docId)) {
      cb(new Error(`Invalid docId — must be one of: ${[...ALLOWED_DOC_IDS].join(", ")}`), "");
      return;
    }
    cb(null, `${docId}.jpg`);
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
 *   file   — image
 *   uid    — driver UID
 *   docId  — selfie | aadhaar | pan | license | rc | insurance
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
      { headerPresent: !!authHeader, tokenPresent: !!bearerToken },
      "[SERVER_AUTH_HEADER_PRESENT]",
    );

    if (!bearerToken) {
      res.status(401).json({ ok: false, error: "Authorization header with Bearer token is required." });
      return;
    }

    let tokenUid: string;
    try {
      const auth    = await adminAuth();
      const decoded = await auth.verifyIdToken(bearerToken);
      tokenUid = decoded.uid;
      req.log.info({ tokenUid }, "[SERVER_VERIFY_TOKEN_OK]");
    } catch (err) {
      const e = err as Error & { code?: string };
      req.log.warn(
        { code: e?.code, message: e?.message, name: e?.name },
        "[SERVER_VERIFY_TOKEN_FAIL]",
      );
      res.status(401).json({ ok: false, error: "Invalid or expired token." });
      return;
    }

    // ── 2. Validate body fields ─────────────────────────────────────────────
    const { uid, docId } = req.body as { uid?: string; docId?: string };

    if (!uid) {
      res.status(400).json({ ok: false, error: "uid is required." });
      return;
    }
    if (!docId || !ALLOWED_DOC_IDS.has(docId)) {
      res.status(400).json({ ok: false, error: `docId must be one of: ${[...ALLOWED_DOC_IDS].join(", ")}.` });
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
        docId,
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
    // Falls back to the incoming Host header for Replit / local dev.
    const publicBase =
      process.env["API_PUBLIC_URL"] ??
      `${req.protocol}://${req.headers["host"] ?? "localhost"}`;

    // Files are served at /api/uploads/kyc/<uid>/<docId>.jpg
    const downloadURL = `${publicBase}/api/uploads/kyc/${uid}/${docId}.jpg`;

    res.status(200).json({ ok: true, url: downloadURL });
  },
);

export default router;
