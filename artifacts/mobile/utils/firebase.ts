import { getApps, initializeApp } from "firebase/app";
import { getAuth, initializeAuth } from "firebase/auth";
import type { Persistence } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
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

// Firestore needs long-polling in Expo Go (no WebSocket support in Expo Go < SDK 51)
let db: ReturnType<typeof getFirestore>;
try {
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
} catch {
  db = getFirestore(app);
}

export { db };
