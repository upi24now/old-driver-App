import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Profile, Vehicle } from "@/contexts/DriverContext";

export type DriverDoc = {
  uid:          string;
  phone:        string;
  name?:        string;
  city?:        string;
  gender?:      string;
  vehicleId?:   string;
  vehicleName?: string;
  isOnline:     boolean;
  createdAt:    unknown;
};

export async function getDriverDoc(uid: string): Promise<DriverDoc | null> {
  const snap = await getDoc(doc(db, "drivers", uid));
  return snap.exists() ? (snap.data() as DriverDoc) : null;
}

export async function createDriverDoc(uid: string, phone: string): Promise<DriverDoc> {
  const data: Omit<DriverDoc, "createdAt"> & { createdAt: unknown } = {
    uid,
    phone,
    isOnline:  false,
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(db, "drivers", uid), data, { merge: true });
  return { ...data, createdAt: Date.now() };
}

export async function updateDriverProfile(uid: string, p: Profile): Promise<void> {
  await updateDoc(doc(db, "drivers", uid), {
    name:   p.name,
    city:   p.city,
    gender: p.gender,
  });
}

export async function updateDriverVehicle(uid: string, v: Vehicle): Promise<void> {
  await updateDoc(doc(db, "drivers", uid), {
    vehicleId:   v.id,
    vehicleName: v.name,
  });
}
