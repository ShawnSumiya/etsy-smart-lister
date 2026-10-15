import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "session_token";
const SESSION_VERSION = 1;
const MAX_TOKEN_LENGTH = 2000;

export type SessionPayload = {
  v: 1;
  sub: string;
  iat: number;
  exp: number;
};

export function hashLicenseKey(licenseKey: string): string {
  return createHash("sha256").update(licenseKey, "utf8").digest("hex");
}

export function generateLicenseKey(): string {
  const hex = randomBytes(24).toString("hex");
  return hex.match(/.{8}/g)!.join("-");
}

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return secret;
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function createSessionToken(
  licenseId: string,
  licenseExpiresAt: Date,
  now = new Date()
): { token: string; maxAge: number } {
  const sessionCapSeconds = 7 * 24 * 60 * 60;
  const untilLicense = Math.floor((licenseExpiresAt.getTime() - now.getTime()) / 1000);
  const maxAge = Math.max(1, Math.min(sessionCapSeconds, untilLicense));
  const iat = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    sub: licenseId,
    iat,
    exp: iat + maxAge,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  return { token: `${body}.${signature}`, maxAge };
}

export function verifySessionToken(token: string, now = new Date()): SessionPayload | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (payload.v !== SESSION_VERSION) return null;
    if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 100) {
      return null;
    }
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
    if (payload.exp * 1000 <= now.getTime()) return null;
    return payload;
  } catch {
    return null;
  }
}
