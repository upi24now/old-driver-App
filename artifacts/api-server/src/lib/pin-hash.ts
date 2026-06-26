import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Node built-in scrypt — secure, dependency-free, and safe to bundle with
// esbuild (no native addon like bcrypt/argon2). The stored format is
// `scrypt$<saltHex>$<hashHex>` so the salt travels with the hash.

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;
const SALT_BYTES = 16;

/** Hash a PIN with a fresh random salt. Never store the raw PIN. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(pin, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Constant-time compare a candidate PIN against a stored scrypt hash. */
export async function verifyPinHash(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const saltHex = parts[1];
  const hashHex = parts[2];
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  const derived = await scrypt(pin, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
