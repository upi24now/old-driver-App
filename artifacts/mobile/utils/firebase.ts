import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";

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

// In React Native, Metro resolves firebase/auth to the RN-specific build which
// uses @react-native-async-storage/async-storage automatically for persistence.
export const firebaseAuth = getAuth(app);

// Firestore needs long-polling in Expo Go (no WebSocket support in Expo Go < SDK 51)
let db: ReturnType<typeof getFirestore>;
try {
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
} catch {
  db = getFirestore(app);
}

export { db };
