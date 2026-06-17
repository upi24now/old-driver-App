// ── Types ──────────────────────────────────────────────────────────────────────

export type DocType =
  | "selfie" | "aadhaarFront" | "aadhaarBack" | "pan"
  | "licenseFront" | "licenseBack" | "rcFront" | "rcBack";

export interface DocEntry {
  url?:    string | null;
  uri?:    string | null;
  status?: string | null;
}

export interface DriverEntry {
  uid:                  string;
  name:                 string | null;
  phone:                string | null;
  city:                 string | null;
  vehicleId:            string | null;
  vehicleNumber:        string | null;
  licenseNumber:        string | null;
  verificationStatus:   "pending" | "approved" | "rejected" | string;
  accountStatus:        "active" | "suspended" | "blacklisted" | null;
  documentsSubmittedAt: string | null;
  documents:            Partial<Record<DocType, DocEntry>>;
}

export interface AdminUser {
  phone:     string;
  name:      string | null;
  role:      "owner" | "manager" | "support" | string;
  isActive:  boolean;
  createdAt: string | null;
  createdBy: string | null;
}

// ── Auth token helpers ──────────────────────────────────────────────────────────

export const getAdminToken = (): string | null => sessionStorage.getItem("adminJwt");

const authHeaders = (): Record<string, string> => ({
  "Authorization": `Bearer ${getAdminToken() ?? ""}`,
  "Content-Type":  "application/json",
});

// ── Core fetch wrapper ─────────────────────────────────────────────────────────

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((err["error"] as string) || `API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Public fetch — no auth headers (used for login endpoints) */
async function publicFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((err["error"] as string) || `API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export function requestOtp(phone: string) {
  return publicFetch<{ ok: true; message: string }>(
    "/api/admin/auth/request-otp",
    { method: "POST", body: JSON.stringify({ phone }) },
  );
}

export function verifyOtp(phone: string, otp: string) {
  return publicFetch<{ ok: true; token: string; user: { phone: string; name: string; role: string } }>(
    "/api/admin/auth/verify-otp",
    { method: "POST", body: JSON.stringify({ phone, otp }) },
  );
}

// ── Drivers / KYC ──────────────────────────────────────────────────────────────

export function fetchDrivers(status?: "pending" | "approved" | "rejected" | "all") {
  const url = status && status !== "all"
    ? `/api/kyc/drivers?status=${status}`
    : `/api/kyc/drivers`;
  return apiFetch<{ ok: boolean; drivers: DriverEntry[] }>(url).then((r) => r.drivers);
}

export function approveDriver(uid: string) {
  return apiFetch<{ ok: true }>(`/api/kyc/${uid}/approve`, { method: "POST" });
}

export function rejectDriver(uid: string, reason?: string, rejectedDocIds?: string[]) {
  return apiFetch<{ ok: true }>(`/api/kyc/${uid}/reject`, {
    method: "POST",
    body:   JSON.stringify({ reason, rejectedDocIds }),
  });
}

export function suspendDriver(uid: string, reason?: string) {
  return apiFetch<{ ok: true }>(`/api/kyc/${uid}/suspend`, {
    method: "POST",
    body:   JSON.stringify({ reason }),
  });
}

export function blacklistDriver(uid: string, reason?: string) {
  return apiFetch<{ ok: true }>(`/api/kyc/${uid}/blacklist`, {
    method: "POST",
    body:   JSON.stringify({ reason }),
  });
}

export function unsuspendDriver(uid: string) {
  return apiFetch<{ ok: true }>(`/api/kyc/${uid}/unsuspend`, { method: "POST" });
}

// ── Admin Orders ───────────────────────────────────────────────────────────────

export interface OrderEntry {
  id:             string;
  status:         string;
  customerId:     string | null;
  customerName:   string | null;
  customerPhone:  string | null;
  customerRating: number | null;
  driverUid:      string | null;
  driverName:     string | null;
  pickupAddress:  string | null;
  dropAddress:    string | null;
  fareEstimate:   number | null;
  paymentMode:    string | null;
  createdAt:      string | null;
  deliveredAt:    string | null;
  acceptedAt:     string | null;
  rejectedBy:     string[];
}

export interface DriverDetail extends DriverEntry {
  rating:               number | null;
  isOnline:             boolean;
  latitude:             number | null;
  longitude:            number | null;
  lastSeenAt:           string | null;
  walletBalance:        number;
  totalEarnings:        number;
  completedDeliveries:  number;
  totalPaid:            number;
  ordersCompleted:      number;
  ordersCancelled:      number;
  ordersRejectedBy:     number;
  suspendReason:        string | null;
  blacklistReason:      string | null;
}

export function fetchAllOrders(status?: string, limit = 100) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("limit", String(limit));
  return apiFetch<{ ok: boolean; orders: OrderEntry[] }>(
    `/api/admin/orders?${params.toString()}`,
  ).then((r) => r.orders);
}

export function fetchDriverDetail(uid: string) {
  return apiFetch<{ ok: boolean; driver: DriverDetail }>(
    `/api/admin/drivers/${encodeURIComponent(uid)}/detail`,
  ).then((r) => r.driver);
}

// ── Admin Users ────────────────────────────────────────────────────────────────

export function fetchAdminUsers() {
  return apiFetch<{ ok: true; users: AdminUser[] }>("/api/admin/users")
    .then((r) => r.users);
}

export function createAdminUser(phone: string, name: string, role: string) {
  return apiFetch<{ ok: true }>("/api/admin/users", {
    method: "POST",
    body:   JSON.stringify({ phone, name, role }),
  });
}

export function disableAdminUser(phone: string) {
  return apiFetch<{ ok: true }>(
    `/api/admin/users/${encodeURIComponent(phone)}/disable`,
    { method: "PATCH" },
  );
}

export function enableAdminUser(phone: string) {
  return apiFetch<{ ok: true }>(
    `/api/admin/users/${encodeURIComponent(phone)}/enable`,
    { method: "PATCH" },
  );
}
