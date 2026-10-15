import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LicensePatch, LicenseRecord, LicenseStore } from "./store";

const SELECT_COLUMNS =
  "id, key_hash, buyer_id, is_active, valid_from, expires_at, revoked_at, rate_window_start, rate_count";

type LicenseRow = {
  id: string;
  key_hash: string | null;
  buyer_id: string | null;
  is_active: boolean | null;
  valid_from: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  rate_window_start: string | null;
  rate_count: number | null;
};

function mapRow(row: LicenseRow): LicenseRecord {
  return {
    id: String(row.id),
    keyHash: row.key_hash ?? "",
    buyerId: row.buyer_id,
    isActive: Boolean(row.is_active),
    validFrom: row.valid_from ?? "",
    expiresAt: row.expires_at ?? "",
    revokedAt: row.revoked_at,
    rateWindowStart: row.rate_window_start,
    rateCount: row.rate_count ?? 0,
  };
}

function logStoreError(error: { code?: string; message?: string } | null) {
  console.error("license store error", error?.code ?? "unknown");
}

export class SupabaseLicenseStore implements LicenseStore {
  constructor(private readonly client: SupabaseClient) {}

  async findById(id: string): Promise<LicenseRecord | null> {
    const { data, error } = await this.client
      .from("license_keys")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      logStoreError(error);
      throw new Error("license lookup failed");
    }
    return data ? mapRow(data as LicenseRow) : null;
  }

  async findByKeyHash(keyHash: string): Promise<LicenseRecord | null> {
    const { data, error } = await this.client
      .from("license_keys")
      .select(SELECT_COLUMNS)
      .eq("key_hash", keyHash)
      .maybeSingle();
    if (error) {
      logStoreError(error);
      throw new Error("license lookup failed");
    }
    return data ? mapRow(data as LicenseRow) : null;
  }

  async findByLegacyKey(licenseKey: string): Promise<LicenseRecord | null> {
    const { data, error } = await this.client
      .from("license_keys")
      .select(SELECT_COLUMNS)
      .eq("key", licenseKey)
      .maybeSingle();
    if (error) {
      logStoreError(error);
      throw new Error("license lookup failed");
    }
    return data ? mapRow(data as LicenseRow) : null;
  }

  async insert(record: LicenseRecord): Promise<void> {
    const { error } = await this.client.from("license_keys").insert({
      id: record.id,
      key: null,
      key_hash: record.keyHash,
      buyer_id: record.buyerId,
      is_active: record.isActive,
      valid_from: record.validFrom,
      expires_at: record.expiresAt,
      revoked_at: record.revokedAt,
      rate_window_start: record.rateWindowStart,
      rate_count: record.rateCount,
    });
    if (error) {
      logStoreError(error);
      throw new Error("license insert failed");
    }
  }

  async update(id: string, patch: LicensePatch): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.isActive !== undefined) row.is_active = patch.isActive;
    if (patch.revokedAt !== undefined) row.revoked_at = patch.revokedAt;
    if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt;
    if (patch.validFrom !== undefined) row.valid_from = patch.validFrom;
    if (patch.rateWindowStart !== undefined) row.rate_window_start = patch.rateWindowStart;
    if (patch.rateCount !== undefined) row.rate_count = patch.rateCount;
    if (patch.buyerId !== undefined) row.buyer_id = patch.buyerId;

    const { error } = await this.client.from("license_keys").update(row).eq("id", id);
    if (error) {
      logStoreError(error);
      throw new Error("license update failed");
    }
  }

  async consumeRate(id: string, limit: number, windowMs: number, now: Date): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.findById(id);
      if (!current) return false;
      const startMs = current.rateWindowStart ? new Date(current.rateWindowStart).getTime() : 0;
      const inWindow = Boolean(startMs) && now.getTime() - startMs < windowMs;

      if (!inWindow) {
        const { data, error } = await this.client
          .from("license_keys")
          .update({
            rate_window_start: now.toISOString(),
            rate_count: 1,
          })
          .eq("id", id)
          .eq("rate_count", current.rateCount)
          .select("id");
        if (error) {
          logStoreError(error);
          throw new Error("rate limit update failed");
        }
        if (data && data.length > 0) return true;
        continue;
      }

      if (current.rateCount >= limit) return false;
      const { data, error } = await this.client
        .from("license_keys")
        .update({ rate_count: current.rateCount + 1 })
        .eq("id", id)
        .eq("rate_count", current.rateCount)
        .select("id");
      if (error) {
        logStoreError(error);
        throw new Error("rate limit update failed");
      }
      if (data && data.length > 0) return true;
    }
    return false;
  }
}

let cached: SupabaseLicenseStore | null = null;

export function getSupabaseLicenseStore(): SupabaseLicenseStore {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  cached = new SupabaseLicenseStore(createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
  return cached;
}
