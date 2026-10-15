export type LicenseRecord = {
  id: string;
  keyHash: string;
  buyerId: string | null;
  isActive: boolean;
  validFrom: string;
  expiresAt: string;
  revokedAt: string | null;
  rateWindowStart: string | null;
  rateCount: number;
};

export type LicensePatch = Partial<
  Pick<
    LicenseRecord,
    | "isActive"
    | "revokedAt"
    | "expiresAt"
    | "validFrom"
    | "rateWindowStart"
    | "rateCount"
    | "buyerId"
  >
>;

export interface LicenseStore {
  findById(id: string): Promise<LicenseRecord | null>;
  findByKeyHash(keyHash: string): Promise<LicenseRecord | null>;
  findByLegacyKey(licenseKey: string): Promise<LicenseRecord | null>;
  insert(record: LicenseRecord): Promise<void>;
  update(id: string, patch: LicensePatch): Promise<void>;
  consumeRate(id: string, limit: number, windowMs: number, now: Date): Promise<boolean>;
}

function cloneRecord(record: LicenseRecord): LicenseRecord {
  return { ...record };
}

export class MemoryLicenseStore implements LicenseStore {
  private readonly records = new Map<string, LicenseRecord>();
  private readonly legacyKeys = new Map<string, string>();

  async findById(id: string): Promise<LicenseRecord | null> {
    const record = this.records.get(id);
    return record ? cloneRecord(record) : null;
  }

  async findByKeyHash(keyHash: string): Promise<LicenseRecord | null> {
    for (const record of this.records.values()) {
      if (record.keyHash === keyHash) return cloneRecord(record);
    }
    return null;
  }

  async findByLegacyKey(licenseKey: string): Promise<LicenseRecord | null> {
    const id = this.legacyKeys.get(licenseKey);
    if (!id) return null;
    return this.findById(id);
  }

  async insert(record: LicenseRecord): Promise<void> {
    if (this.records.has(record.id)) {
      throw new Error("license id already exists");
    }
    for (const existing of this.records.values()) {
      if (existing.keyHash === record.keyHash) {
        throw new Error("license hash already exists");
      }
    }
    this.records.set(record.id, cloneRecord(record));
  }

  async insertLegacy(record: LicenseRecord, legacyKey: string): Promise<void> {
    await this.insert(record);
    this.legacyKeys.set(legacyKey, record.id);
  }

  async update(id: string, patch: LicensePatch): Promise<void> {
    const current = this.records.get(id);
    if (!current) throw new Error("license not found");
    this.records.set(id, { ...current, ...patch });
  }

  async consumeRate(id: string, limit: number, windowMs: number, now: Date): Promise<boolean> {
    const current = this.records.get(id);
    if (!current) return false;
    const startMs = current.rateWindowStart ? new Date(current.rateWindowStart).getTime() : 0;
    const inWindow = Boolean(startMs) && now.getTime() - startMs < windowMs;
    if (!inWindow) {
      current.rateWindowStart = now.toISOString();
      current.rateCount = 1;
      return true;
    }
    if (current.rateCount >= limit) return false;
    current.rateCount += 1;
    return true;
  }

  containsPlaintext(value: string): boolean {
    for (const record of this.records.values()) {
      if (Object.values(record).some((field) => field === value)) return true;
    }
    return this.legacyKeys.has(value);
  }
}
