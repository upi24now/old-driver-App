/**
 * firebase-admin.ts — Firebase Admin SDK initialisation.
 *
 * Credential methods (resolved by config.ts, in priority order):
 *   1. Individual env vars   FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 *   2. Inline JSON           FIREBASE_SERVICE_ACCOUNT_JSON
 *   3. ADC file              GOOGLE_APPLICATION_CREDENTIALS
 *
 * Behaviour
 * ─────────
 * • Lazy init: SDK is initialised on the first call to adminAuth() / adminFirestore()
 *   / adminMessaging().  This is intentional — dotenv must run before init.
 * • Fail loudly: if credentials are missing or invalid the exported functions
 *   throw a descriptive error.  There is no stub / mock / dev-token fallback.
 * • Idempotent: if a Firebase app already exists (e.g. hot-reload) it is reused.
 */

import { getConfig }  from "./config";
import { logger }     from "./logger";

// ─── SDK handles ─────────────────────────────────────────────────────────────
let _auth:      import("firebase-admin/auth").Auth      | null = null;
let _db:        import("firebase-admin/firestore").Firestore | null = null;
let _messaging: import("firebase-admin/messaging").Messaging | null = null;
let _appReady   = false;
let _initError: string | null = null;

// ─── Initialisation ───────────────────────────────────────────────────────────

async function getAdminApp(): Promise<void> {
  if (_appReady || _initError) return;

  const cfg = getConfig(); // validated at startup; never throws here
  const fb  = cfg.firebase;

  try {
    const { initializeApp, getApps, cert, applicationDefault } =
      await import("firebase-admin/app");
    const { getAuth }      = await import("firebase-admin/auth");
    const { getFirestore } = await import("firebase-admin/firestore");
    const { getMessaging } = await import("firebase-admin/messaging");

    // Reuse an existing app instance (hot-reload / multiple callers)
    const existing = getApps();
    let app: import("firebase-admin/app").App;

    if (existing.length > 0) {
      app = existing[0]!;
    } else if (fb.method === "individual") {
      app = initializeApp({
        credential: cert({
          projectId:   fb.projectId,
          clientEmail: fb.clientEmail,
          privateKey:  fb.privateKey,
        }),
      });
      logger.info({ projectId: fb.projectId }, "[FIREBASE] Admin SDK initialised (individual vars)");

    } else if (fb.method === "serviceAccountJson") {
      const sa = fb.serviceAccount;
      app = initializeApp({
        credential: cert(sa as Parameters<typeof cert>[0]),
      });
      logger.info(
        { projectId: sa["project_id"] ?? "?" },
        "[FIREBASE] Admin SDK initialised (service-account JSON)",
      );

    } else {
      // applicationDefault — uses GOOGLE_APPLICATION_CREDENTIALS env var
      app = initializeApp({ credential: applicationDefault() });
      logger.info("[FIREBASE] Admin SDK initialised (applicationDefault / GOOGLE_APPLICATION_CREDENTIALS)");
    }

    _auth      = getAuth(app);
    _db        = getFirestore(app);
    _messaging = getMessaging(app);
    _appReady  = true;

  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : String(err);
    _initError = `Firebase Admin SDK initialisation failed: ${msg}`;
    logger.error({ err }, `[FIREBASE] ${_initError}`);
  }
}

// ─── Public accessors ─────────────────────────────────────────────────────────

export async function adminAuth(): Promise<import("firebase-admin/auth").Auth> {
  await getAdminApp();
  if (!_auth) {
    throw new Error(
      _initError ??
      "[FIREBASE] Auth is unavailable — check Firebase credentials in your environment.",
    );
  }
  return _auth;
}

export async function adminFirestore(): Promise<import("firebase-admin/firestore").Firestore> {
  await getAdminApp();
  if (!_db) {
    throw new Error(
      _initError ??
      "[FIREBASE] Firestore is unavailable — check Firebase credentials in your environment.",
    );
  }
  return _db;
}

export async function adminMessaging(): Promise<import("firebase-admin/messaging").Messaging> {
  await getAdminApp();
  if (!_messaging) {
    throw new Error(
      _initError ??
      "[FIREBASE] Messaging is unavailable — check Firebase credentials in your environment.",
    );
  }
  return _messaging;
}
