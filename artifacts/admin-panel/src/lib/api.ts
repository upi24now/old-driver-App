export type DocType = "selfie" | "aadhaarFront" | "aadhaarBack" | "pan" | "licenseFront" | "licenseBack" | "rcFront" | "rcBack";

export interface DocEntry {
  url?: string | null;
  uri?: string | null;
  status?: string | null;
}

export interface DriverEntry {
  uid: string;
  name: string | null;
  phone: string | null;
  city: string | null;
  vehicleId: string | null;
  vehicleNumber: string | null;
  licenseNumber: string | null;
  verificationStatus: "pending" | "approved" | "rejected" | string;
  accountStatus: "active" | "suspended" | "blacklisted" | null;
  documentsSubmittedAt: string | null;
  documents: Partial<Record<DocType, DocEntry>>;
}

export const getApiKey = () => sessionStorage.getItem("adminApiKey");

export const authHeaders = () => ({
  "x-admin-token": getApiKey() ?? "",
  "Content-Type": "application/json"
});

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders(),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `API error: ${res.status}`);
  }
  return res.json();
}

export function fetchDrivers(status?: "pending" | "approved" | "rejected" | "all") {
  const url = status && status !== "all" ? `/api/kyc/drivers?status=${status}` : `/api/kyc/drivers`;
  return apiFetch<{ ok: boolean; drivers: DriverEntry[] }>(url).then(res => res.drivers);
}

export function approveDriver(uid: string) {
  return apiFetch<{ ok: true }>(`/api/kyc/${uid}/approve`, { method: "POST" });
}

export function rejectDriver(uid: string, reason?: string, rejectedDocIds?: string[]) {
  return apiFetch<{ ok: true }>(`/api/kyc/${uid}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason, rejectedDocIds }),
  });
}

export function suspendDriver(uid: string) {
  return apiFetch<{ ok: true }>(`/api/kyc/${uid}/suspend`, { method: "POST" });
}

export function blacklistDriver(uid: string) {
  return apiFetch<{ ok: true }>(`/api/kyc/${uid}/blacklist`, { method: "POST" });
}

export function unsuspendDriver(uid: string) {
  return apiFetch<{ ok: true }>(`/api/kyc/${uid}/unsuspend`, { method: "POST" });
}
