import { logger } from "./logger";

let _auth: import("firebase-admin/auth").Auth | null = null;
let _appReady = false;
let _initError: string | null = null;

async function getAdminApp() {
  if (_appReady || _initError) return;

  const projectId    = process.env["FIREBASE_PROJECT_ID"];
  const clientEmail  = process.env["FIREBASE_CLIENT_EMAIL"];
  const rawKey       = process.env["FIREBASE_PRIVATE_KEY"];

  if (!projectId || !clientEmail || !rawKey) {
    _initError =
      "Firebase Admin not configured — set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY";
    logger.warn(_initError);
    return;
  }

  // Replit stores secrets with literal \n — replace with real newlines.
  // Also handle the case where the key was pasted with real newlines already.
  const privateKey = rawKey.includes("\\n")
    ? rawKey.replace(/\\n/g, "\n")
    : rawKey;

  try {
    const { initializeApp, getApps, cert } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");

    const existing = getApps();
    const app =
      existing.length > 0
        ? existing[0]!
        : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });

    _auth = getAuth(app);
    _appReady = true;
    logger.info({ projectId }, "Firebase Admin initialized");
  } catch (err) {
    _initError = "Firebase Admin init failed";
    logger.error({ err }, _initError);
  }
}

export async function adminAuth(): Promise<import("firebase-admin/auth").Auth> {
  await getAdminApp();
  if (!_auth) throw new Error(_initError ?? "Firebase Admin Auth unavailable");
  return _auth;
}
