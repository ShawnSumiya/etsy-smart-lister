import { randomUUID } from "node:crypto";
import {
  createSessionToken,
  generateLicenseKey,
  hashLicenseKey,
  verifySessionToken,
} from "./crypto";
import { getSupabaseLicenseStore } from "./supabase-store";
import { addCalendarMonths } from "./calendar";
import { MemoryLicenseStore, type LicenseRecord, type LicenseStore } from "./store";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DURATION_DAYS = 30;
const DEFAULT_LICENSE_MONTHS = 1;
const DEFAULT_RATE_LIMIT_MAX = 30;
const DEFAULT_RATE_WINDOW_SECONDS = 60 * 60;

export type AccessFailure = {
  ok: false;
  status: 401 | 403 | 429 | 503;
  code: "unauthorized" | "expired" | "revoked" | "inactive" | "not_started" | "rate_limited" | "unavailable";
  message: string;
};

export type AccessSuccess = { ok: true; license: LicenseRecord };
export type AccessResult = AccessSuccess | AccessFailure;

type RateLimitConfig = { max: number; windowSeconds: number };

let storeOverride: LicenseStore | null = null;
let memorySingleton: MemoryLicenseStore | null = null;
let rateLimitOverride: RateLimitConfig | null = null;

const loginAttempts = new Map<string, { start: number; count: number }>();

export function resetSecurityStateForTests() {
  storeOverride = null;
  memorySingleton = null;
  rateLimitOverride = null;
  loginAttempts.clear();
}

export function setLicenseStore(store: LicenseStore | null) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("License store override is disabled in production");
  }
  storeOverride = store;
}

export function setRateLimitConfigForTests(config: RateLimitConfig | null) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Rate limit override is disabled in production");
  }
  rateLimitOverride = config;
}

export function assertProductionStoreMode() {
  if (process.env.NODE_ENV === "production" && process.env.LICENSE_STORE === "memory") {
    throw new Error("LICENSE_STORE=memory cannot be used in production");
  }
}

export function getLicenseStore(): LicenseStore {
  assertProductionStoreMode();
  if (storeOverride) return storeOverride;
  if (process.env.LICENSE_STORE === "memory") {
    if (!memorySingleton) {
      memorySingleton = new MemoryLicenseStore();
      seedDevLicense(memorySingleton);
    }
    return memorySingleton;
  }
  return getSupabaseLicenseStore();
}

function seedDevLicense(store: MemoryLicenseStore) {
  const devKey = process.env.LICENSE_DEV_KEY?.trim();
  if (!devKey) return;
  const now = new Date();
  void store.insert({
    id: "dev-license",
    keyHash: hashLicenseKey(devKey),
    buyerId: "local-dev",
    isActive: true,
    validFrom: now.toISOString(),
    expiresAt: new Date(now.getTime() + DEFAULT_DURATION_DAYS * DAY_MS).toISOString(),
    revokedAt: null,
    rateWindowStart: null,
    rateCount: 0,
  });
}

export function getRateLimitConfig(): RateLimitConfig {
  if (rateLimitOverride) return rateLimitOverride;
  const max = Number(process.env.LICENSE_RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX);
  const windowSeconds = Number(
    process.env.LICENSE_RATE_LIMIT_WINDOW_SECONDS ?? DEFAULT_RATE_WINDOW_SECONDS
  );
  return {
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_RATE_LIMIT_MAX,
    windowSeconds:
      Number.isFinite(windowSeconds) && windowSeconds > 0
        ? windowSeconds
        : DEFAULT_RATE_WINDOW_SECONDS,
  };
}

export function evaluateLicense(license: LicenseRecord, now = new Date()): AccessResult {
  if (!license.isActive) {
    return {
      ok: false,
      status: 403,
      code: "inactive",
      message: "ライセンスが無効化されています。",
    };
  }
  if (license.revokedAt && new Date(license.revokedAt).getTime() <= now.getTime()) {
    return {
      ok: false,
      status: 403,
      code: "revoked",
      message: "ライセンスが無効化されています。",
    };
  }
  if (!license.validFrom || !license.expiresAt) {
    return {
      ok: false,
      status: 403,
      code: "inactive",
      message: "ライセンスが無効化されています。",
    };
  }
  if (new Date(license.validFrom).getTime() > now.getTime()) {
    return {
      ok: false,
      status: 403,
      code: "not_started",
      message: "ライセンスの有効期間前です。",
    };
  }
  if (new Date(license.expiresAt).getTime() <= now.getTime()) {
    return {
      ok: false,
      status: 403,
      code: "expired",
      message: "ライセンスの有効期限が切れています。",
    };
  }
  return { ok: true, license };
}

async function findPresentedLicense(licenseKey: string): Promise<LicenseRecord | null> {
  const store = getLicenseStore();
  const byHash = await store.findByKeyHash(hashLicenseKey(licenseKey));
  if (byHash) return byHash;
  return store.findByLegacyKey(licenseKey);
}

export function consumeLoginAttempt(ip: string, now = new Date()): boolean {
  const windowMs = 10 * 60 * 1000;
  const max = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 20);
  const limit = Number.isFinite(max) && max > 0 ? max : 20;
  const current = loginAttempts.get(ip);
  if (!current || now.getTime() - current.start >= windowMs) {
    loginAttempts.set(ip, { start: now.getTime(), count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export async function loginWithLicenseKey(
  licenseKey: string,
  now = new Date()
): Promise<
  | { ok: true; token: string; maxAge: number; expiresAt: string }
  | AccessFailure
> {
  const trimmed = licenseKey.trim();
  if (!trimmed || trimmed.length > 500) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "ライセンスキーが無効です。",
    };
  }

  let license: LicenseRecord | null;
  try {
    license = await findPresentedLicense(trimmed);
  } catch {
    console.error("license login lookup failed");
    return {
      ok: false,
      status: 503,
      code: "unavailable",
      message: "認証サービスが利用できません。",
    };
  }

  if (!license) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "ライセンスキーが無効です。",
    };
  }

  const evaluated = evaluateLicense(license, now);
  if (!evaluated.ok) return evaluated;

  try {
    const session = createSessionToken(license.id, new Date(license.expiresAt), now);
    return { ok: true, ...session, expiresAt: license.expiresAt };
  } catch {
    console.error("session signing failed");
    return {
      ok: false,
      status: 503,
      code: "unavailable",
      message: "認証サービスが利用できません。",
    };
  }
}

export async function requireLicenseToken(token: string | undefined, now = new Date()): Promise<AccessResult> {
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "認証が必要です。",
    };
  }

  let payload;
  try {
    payload = verifySessionToken(token, now);
  } catch {
    console.error("session verification failed");
    return {
      ok: false,
      status: 503,
      code: "unavailable",
      message: "認証サービスが利用できません。",
    };
  }

  if (!payload) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "認証が必要です。",
    };
  }

  let license: LicenseRecord | null;
  try {
    license = await getLicenseStore().findById(payload.sub);
  } catch {
    console.error("license session lookup failed");
    return {
      ok: false,
      status: 503,
      code: "unavailable",
      message: "認証サービスが利用できません。",
    };
  }

  if (!license) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "認証が必要です。",
    };
  }

  return evaluateLicense(license, now);
}

export async function consumeGenerationRate(licenseId: string, now = new Date()): Promise<AccessFailure | { ok: true }> {
  const { max, windowSeconds } = getRateLimitConfig();
  try {
    const allowed = await getLicenseStore().consumeRate(licenseId, max, windowSeconds * 1000, now);
    if (!allowed) {
      return {
        ok: false,
        status: 429,
        code: "rate_limited",
        message: "リクエスト回数の上限に達しました。しばらく待ってから再度お試しください。",
      };
    }
    return { ok: true };
  } catch {
    console.error("rate limit check failed");
    return {
      ok: false,
      status: 503,
      code: "unavailable",
      message: "認証サービスが利用できません。",
    };
  }
}

export async function issueLicense(input: {
  buyerId: string;
  durationDays?: number;
  months?: number;
  validFrom?: Date;
  now?: Date;
}): Promise<{ licenseKey: string; id: string; buyerId: string; validFrom: string; expiresAt: string }> {
  const buyerId = input.buyerId.trim();
  if (!buyerId || buyerId.length > 200) {
    throw new Error("buyerId is required");
  }
  const hasDays = input.durationDays !== undefined;
  const hasMonths = input.months !== undefined;
  if (hasDays && hasMonths) {
    throw new Error("specify either months or durationDays");
  }

  const now = input.now ?? new Date();
  const validFrom = input.validFrom ?? now;
  let expiresAt: Date;
  if (hasDays) {
    const durationDays = input.durationDays ?? DEFAULT_DURATION_DAYS;
    if (!Number.isInteger(durationDays) || durationDays <= 0 || durationDays > 366) {
      throw new Error("durationDays must be between 1 and 366");
    }
    expiresAt = new Date(validFrom.getTime() + durationDays * DAY_MS);
  } else {
    const months = hasMonths ? input.months ?? DEFAULT_LICENSE_MONTHS : DEFAULT_LICENSE_MONTHS;
    expiresAt = addCalendarMonths(validFrom, months);
  }
  const licenseKey = generateLicenseKey();
  const record: LicenseRecord = {
    id: randomUUID(),
    keyHash: hashLicenseKey(licenseKey),
    buyerId,
    isActive: true,
    validFrom: validFrom.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revokedAt: null,
    rateWindowStart: null,
    rateCount: 0,
  };
  await getLicenseStore().insert(record);
  return {
    licenseKey,
    id: record.id,
    buyerId,
    validFrom: record.validFrom,
    expiresAt: record.expiresAt,
  };
}
