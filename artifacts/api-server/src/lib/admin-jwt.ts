/**
 * admin-jwt.ts
 *
 * HMAC-SHA256 signed JWT for admin sessions.
 * Uses Node's built-in `crypto` — no extra package required.
 * Token expires in 12 hours.
 * Secret: SESSION_SECRET env var (required in production).
 */

import { createHmac, timingSafeEqual } from "crypto";

const EXPIRY_SECONDS = 43_200; // 12 hours

export interface AdminJwtPayload {
  phone: string;
  role:  string;
  name:  string;
}

function b64url(str: string): string {
  return Buffer.from(str).toString("base64url");
}

function fromb64url(str: string): string {
  return Buffer.from(str, "base64url").toString("utf8");
}

export function signAdminJwt(payload: AdminJwtPayload): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET env var is not set");

  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + EXPIRY_SECONDS,
    }),
  );
  const sig = createHmac("sha256", secret)
    .update(`${header}.${claims}`)
    .digest("base64url");

  return `${header}.${claims}.${sig}`;
}

export function verifyAdminJwt(token: string): AdminJwtPayload | null {
  try {
    const secret = process.env["SESSION_SECRET"];
    if (!secret) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, claims, sig] = parts as [string, string, string];

    const expected = createHmac("sha256", secret)
      .update(`${header}.${claims}`)
      .digest("base64url");

    const sigBuf = Buffer.from(sig,      "base64url");
    const expBuf = Buffer.from(expected, "base64url");

    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;

    const p = JSON.parse(fromb64url(claims)) as AdminJwtPayload & {
      exp: number;
    };
    if (p.exp < Math.floor(Date.now() / 1000)) return null;

    return { phone: p.phone, role: p.role, name: p.name };
  } catch {
    return null;
  }
}
