import { getApps, initializeApp } from "firebase/app";
import { getAuth, initializeAuth } from "firebase/auth";
import type { Persistence } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  memoryLruGarbageCollector,
  CACHE_SIZE_UNLIMITED,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey:            process.env["EXPO_PUBLIC_FIREBASE_API_KEY"]             ?? "",
  authDomain:        process.env["EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN"]         ?? "",
  projectId:         process.env["EXPO_PUBLIC_FIREBASE_PROJECT_ID"]          ?? "",
  storageBucket:     process.env["EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET"]      ?? "",
  messagingSenderId: process.env["EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"] ?? "",
  appId:             process.env["EXPO_PUBLIC_FIREBASE_APP_ID"]              ?? "",
};

// Singleton — Metro / Fast Refresh may re-evaluate this module
const existingApps = getApps();
const app = existingApps.length > 0 ? existingApps[0]! : initializeApp(firebaseConfig);

// getReactNativePersistence is exported from the react-native build of firebase/auth
// (Metro uses the react-native condition at runtime), but tsc resolves to the browser
// types which don't include it. require() lets us reach the runtime export without
// a type error. The cast is safe: at runtime Metro always provides the RN build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getReactNativePersistence } = require("firebase/auth") as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

// initializeAuth throws "auth/already-initialized" on Fast Refresh re-evaluation.
// Fall back to getAuth(app) which returns the already-initialized instance.
let firebaseAuth: ReturnType<typeof getAuth>;
try {
  firebaseAuth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  firebaseAuth = getAuth(app);
}
export { firebaseAuth };

// ─── Firestore ────────────────────────────────────────────────────────────────
//
// PERSISTENCE STRATEGY — Firebase JS SDK 12.x + React Native / Expo SDK 54
//
// ❌ persistentLocalCache()  — uses IndexedDB (window.indexedDB), which does
//    not exist in React Native. Calling it throws [code=unimplemented] at
//    startup. Requires switching to @react-native-firebase/firestore for
//    true cross-restart write persistence.
//
// ✅ memoryLocalCache()  — safe in React Native. Stores the document cache
//    and pending write queue in memory for the lifetime of the app session:
//    • Read cache: repeated reads served from memory (faster, offline-safe)
//    • Write queue: pending writes survive network blips and are retried
//      automatically when connectivity returns — within the same session.
//    • App killed while offline: queued writes are lost. The existing
//      DriverContext re-fetch on mount already handles this correctly by
//      re-reading the authoritative state from Firestore after restart.
//
// NETWORK TRANSPORT
//   experimentalAutoDetectLongPolling: true
//   Expo Go < SDK 51 needed forced long-polling (no WebSocket support).
//   Expo SDK 54 supports WebSockets in Expo Go — auto-detect picks the
//   faster WebSocket transport when available and falls back to long-polling
//   for environments that need it (older Expo Go, restricted networks).
//
let db: ReturnType<typeof getFirestore>;
try {
  db = initializeFirestore(app, {
    // Auto-select WebSocket (preferred) or long-polling — works in Expo Go SDK 54+
    experimentalAutoDetectLongPolling: true,

    // In-session LRU memory cache: improves read latency and queues pending
    // writes through connectivity gaps within the same app session.
    localCache: memoryLocalCache({
      garbageCollector: memoryLruGarbageCollector({ cacheSizeBytes: CACHE_SIZE_UNLIMITED }),
    }),
  });
} catch {
  // Fast Refresh / hot reload re-evaluation — return the existing instance.
  db = getFirestore(app);
}

export { db };

// ─── Firebase Storage ─────────────────────────────────────────────────────────
export const storage = getStorage(app);
