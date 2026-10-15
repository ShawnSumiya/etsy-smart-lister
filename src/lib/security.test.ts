import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as login } from "../app/api/auth/login/route";
import { POST as logout } from "../app/api/auth/logout/route";
import { POST as generate } from "../app/api/generate/route";
import { hashLicenseKey, sessionCookieOptions } from "./license/crypto";
import {
  assertProductionStoreMode,
  issueLicense,
  resetSecurityStateForTests,
  setLicenseStore,
  setRateLimitConfigForTests,
} from "./license/guard";
import { MemoryLicenseStore, type LicenseRecord } from "./license/store";
import { setListingGeneratorForTests, type GenerateInput } from "./listing/generator";
import { SYSTEM_INSTRUCTION, normalizeListing } from "./listing/schema";

const SECRET = "test-session-secret-at-least-32-characters";

function sampleListing() {
  return {
    title: "Minimal Silver Ring, Handmade Everyday Gift",
    tags: Array.from({ length: 13 }, (_, index) => `silver tag ${index + 1}`),
    description: "A calm handmade silver ring for everyday wear.",
    xPost: "A new minimal silver ring. #handmade",
    instagramPost: "The everyday silver ring is ready.\n\n#silverring #handmade",
  };
}

function loginRequest(licenseKey: string) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ licenseKey }),
  });
}

function generateRequest(cookie: string | undefined, body: unknown) {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", `session_token=${cookie}`);
  return new NextRequest("http://localhost/api/generate", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function setCookieHeader(response: Response): string {
  const getter = response.headers.getSetCookie;
  if (typeof getter === "function") return getter.call(response.headers).join("\n");
  return response.headers.get("set-cookie") ?? "";
}

function readSession(response: Response): string {
  const match = setCookieHeader(response).match(/session_token=([^;]+)/);
  return match?.[1] ?? "";
}

async function issueAndLogin(store: MemoryLicenseStore, buyerId = "coconala-100") {
  setLicenseStore(store);
  const now = new Date();
  const issued = await issueLicense({
    buyerId,
    now,
    validFrom: new Date(now.getTime() - 60_000),
  });
  const response = await login(loginRequest(issued.licenseKey));
  assert.equal(response.status, 200);
  const token = readSession(response);
  assert.ok(token);
  assert.notEqual(token, "valid");
  return { issued, token };
}

describe("delivery security", { concurrency: 1 }, () => {
  let store: MemoryLicenseStore;
  let generateCalls: GenerateInput[];

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = SECRET;
    process.env.LOGIN_RATE_LIMIT_MAX = "1000";
    delete process.env.LICENSE_STORE;
    resetSecurityStateForTests();
    store = new MemoryLicenseStore();
    setLicenseStore(store);
    setRateLimitConfigForTests(null);
    generateCalls = [];
    setListingGeneratorForTests(async (input) => {
      generateCalls.push(input);
      return sampleListing();
    });
  });

  test("issues a random key bound to a buyer without storing plaintext", async () => {
    const issued = await issueLicense({
      buyerId: "coconala-trade-42",
      now: new Date("2026-10-15T00:00:00.000Z"),
    });
    const second = await issueLicense({ buyerId: "coconala-trade-42" });
    const record = await store.findById(issued.id);

    assert.notEqual(issued.licenseKey, second.licenseKey);
    assert.equal(record?.buyerId, "coconala-trade-42");
    assert.equal(
      hashLicenseKey("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert.equal(record?.keyHash, hashLicenseKey(issued.licenseKey));
    assert.equal(store.containsPlaintext(issued.licenseKey), false);
    assert.equal(issued.expiresAt, "2026-11-15T00:00:00.000Z");
    assert.equal(issued.validFrom, "2026-10-15T00:00:00.000Z");
  });

  test("keeps an exact day count when durationDays is set", async () => {
    const start = new Date("2026-10-15T06:49:26.299Z");
    const issued = await issueLicense({
      buyerId: "coconala-days",
      durationDays: 30,
      now: start,
      validFrom: start,
    });
    assert.equal(
      new Date(issued.expiresAt).getTime() - start.getTime(),
      30 * 24 * 60 * 60 * 1000
    );
  });

  test("rejects specifying both a calendar month and a day count", async () => {
    await assert.rejects(
      () => issueLicense({ buyerId: "coconala-both", months: 1, durationDays: 30 }),
      /either months or durationDays/
    );
  });

  test("logs in with a valid key and sets a signed HttpOnly cookie", async () => {
    const { token } = await issueAndLogin(store);
    const response = await login(loginRequest((await issueLicense({ buyerId: "other" })).licenseKey));
    const header = setCookieHeader(response);

    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    assert.doesNotMatch(header, /session_token=valid/);
    assert.equal(sessionCookieOptions(60).httpOnly, true);
    assert.equal(sessionCookieOptions(60).sameSite, "lax");
    assert.ok(token.split(".").length === 2);
  });

  test("uses Secure cookies in production", () => {
    process.env.NODE_ENV = "production";
    try {
      assert.equal(sessionCookieOptions(60).secure, true);
      assert.throws(() => setLicenseStore(new MemoryLicenseStore()));
      process.env.LICENSE_STORE = "memory";
      assert.throws(() => assertProductionStoreMode());
    } finally {
      process.env.NODE_ENV = "test";
      delete process.env.LICENSE_STORE;
    }
  });

  test("rejects an unknown key", async () => {
    const response = await login(loginRequest("missing-key"));
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "unauthorized");
    assert.equal(readSession(response), "");
  });

  test("rejects an expired key", async () => {
    const issued = await issueLicense({ buyerId: "coconala-expired" });
    await store.update(issued.id, { expiresAt: "2020-01-01T00:00:00.000Z" });

    const response = await login(loginRequest(issued.licenseKey));
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.code, "expired");
  });

  test("rejects a revoked key and an inactive key", async () => {
    const revoked = await issueLicense({ buyerId: "coconala-revoked" });
    await store.update(revoked.id, { revokedAt: new Date(Date.now() - 60_000).toISOString() });
    const revokedResponse = await login(loginRequest(revoked.licenseKey));
    assert.equal(revokedResponse.status, 403);
    assert.equal((await revokedResponse.json()).code, "revoked");

    const inactive = await issueLicense({ buyerId: "coconala-inactive" });
    await store.update(inactive.id, { isActive: false });
    const inactiveResponse = await login(loginRequest(inactive.licenseKey));
    assert.equal(inactiveResponse.status, 403);
    assert.equal((await inactiveResponse.json()).code, "inactive");
  });

  test("rejects a key before its start time", async () => {
    const issued = await issueLicense({
      buyerId: "coconala-future",
      validFrom: new Date("2099-01-01T00:00:00.000Z"),
    });
    const response = await login(loginRequest(issued.licenseKey));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "not_started");
  });

  test("still accepts a legacy plaintext row without putting new keys in plaintext", async () => {
    const legacy: LicenseRecord = {
      id: randomUUID(),
      keyHash: hashLicenseKey("different-modern-key"),
      buyerId: "legacy-buyer",
      isActive: true,
      validFrom: new Date(Date.now() - 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      revokedAt: null,
      rateWindowStart: null,
      rateCount: 0,
    };
    await store.insertLegacy(legacy, "LEGACY-KEY");

    const response = await login(loginRequest("LEGACY-KEY"));
    assert.equal(response.status, 200);
  });

  test("rejects unauthenticated generation before images or keywords are processed", async () => {
    const response = await generate(
      generateRequest(undefined, {
        keyword: "secret keyword",
        images: Array.from({ length: 11 }, () => "data:image/png;base64,aGVsbG8="),
      })
    );

    assert.equal(response.status, 401);
    assert.equal(generateCalls.length, 0);
  });

  test("rejects the old fixed session cookie", async () => {
    const response = await generate(generateRequest("valid", { keyword: "ring" }));
    assert.equal(response.status, 401);
    assert.equal(generateCalls.length, 0);
  });

  test("rejects a tampered session", async () => {
    const { token } = await issueAndLogin(store);
    const [body, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { sub: string };
    payload.sub = randomUUID();
    const tampered = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;

    const response = await generate(generateRequest(tampered, { keyword: "ring" }));
    assert.equal(response.status, 401);
    assert.equal(generateCalls.length, 0);
  });

  test("rejects generation after the license expires or is revoked in the database", async () => {
    const { issued, token } = await issueAndLogin(store);
    const first = await generate(generateRequest(token, { keyword: "ring" }));
    assert.equal(first.status, 200);
    assert.equal(generateCalls.length, 1);

    await store.update(issued.id, { expiresAt: "2020-01-01T00:00:00.000Z" });
    const expired = await generate(generateRequest(token, { keyword: "ring" }));
    assert.equal(expired.status, 403);
    assert.equal((await expired.json()).code, "expired");
    assert.equal(generateCalls.length, 1);

    await store.update(issued.id, {
      expiresAt: issued.expiresAt,
      isActive: false,
    });
    const revoked = await generate(generateRequest(token, { keyword: "ring" }));
    assert.equal(revoked.status, 403);
    assert.equal((await revoked.json()).code, "inactive");
    assert.equal(generateCalls.length, 1);
  });

  test("keeps normal generation and enforces listing limits", async () => {
    const { token } = await issueAndLogin(store);
    const response = await generate(
      generateRequest(token, {
        keyword: "シルバーリング",
        images: ["data:image/png;base64,aGVsbG8="],
      })
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(generateCalls.length, 1);
    assert.equal(generateCalls[0].keyword, "シルバーリング");
    assert.equal(generateCalls[0].imageParts.length, 1);
    assert.equal(generateCalls[0].imageParts[0].inlineData.data, "aGVsbG8=");
    assert.equal(body.description, sampleListing().description);
    assert.notEqual(body.xPost, body.instagramPost);
    assert.ok(Array.from(body.title).length <= 140);
    assert.equal(body.tags.length, 13);
    assert.ok(body.tags.every((tag: string) => Array.from(tag).length <= 20));
    assert.match(SYSTEM_INSTRUCTION, /xPost/);
    assert.match(SYSTEM_INSTRUCTION, /instagramPost/);
    assert.match(SYSTEM_INSTRUCTION, /description/);
  });

  test("normalizes long titles and tags, and rejects too many images before generation", async () => {
    setListingGeneratorForTests(async (input) => {
      generateCalls.push(input);
      return {
        title: `Handmade ${"Silver ".repeat(40)}Ring`,
        tags: Array.from(
          { length: 14 },
          (_, index) => `${String(index).padStart(2, "0")} custom artwork extra`
        ),
        description: "Kept description",
        xPost: "Short X post",
        instagramPost: "Longer Instagram caption",
      };
    });
    const { token } = await issueAndLogin(store);
    setRateLimitConfigForTests({ max: 1, windowSeconds: 3600 });

    const tooMany = await generate(
      generateRequest(token, {
        images: Array.from({ length: 11 }, () => "data:image/png;base64,aGVsbG8="),
      })
    );
    assert.equal(tooMany.status, 400);
    assert.equal(generateCalls.length, 0);

    const response = await generate(generateRequest(token, { keyword: "ring" }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(Array.from(body.title).length <= 140);
    assert.equal(body.tags.length, 13);
    assert.ok(body.tags.every((tag: string) => Array.from(tag).length <= 20));
    assert.equal(body.description, "Kept description");

    const limited = await generate(generateRequest(token, { keyword: "ring" }));
    assert.equal(limited.status, 429);
    assert.equal(generateCalls.length, 1);
  });

  test("retries an incomplete model response once inside the same rate-limit slot", async () => {
    let calls = 0;
    setListingGeneratorForTests(async (input) => {
      generateCalls.push(input);
      calls += 1;
      if (calls === 1) return { ...sampleListing(), tags: ["only one"] };
      return sampleListing();
    });
    const { token } = await issueAndLogin(store);
    setRateLimitConfigForTests({ max: 1, windowSeconds: 3600 });

    const response = await generate(generateRequest(token, { keyword: "ring" }));
    assert.equal(response.status, 200);
    assert.equal(generateCalls.length, 2);

    const limited = await generate(generateRequest(token, { keyword: "ring" }));
    assert.equal(limited.status, 429);
    assert.equal(generateCalls.length, 2);
  });

  test("stops after one automatic retry when the model output stays incomplete", async () => {
    setListingGeneratorForTests(async (input) => {
      generateCalls.push(input);
      return { ...sampleListing(), tags: ["only one"] };
    });
    const { token } = await issueAndLogin(store);

    const response = await generate(generateRequest(token, { keyword: "ring" }));
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.match(body.error, /13個/);
    assert.equal(generateCalls.length, 2);
  });

  test("does not call the model again when generation throws", async () => {
    let calls = 0;
    setListingGeneratorForTests(async () => {
      calls += 1;
      throw new Error("model unavailable");
    });
    const { token } = await issueAndLogin(store);
    const response = await generate(generateRequest(token, { keyword: "ring" }));
    assert.equal(response.status, 500);
    assert.equal(calls, 1);
  });

  test("rejects a listing that cannot satisfy the 13 tag rule", () => {
    const result = normalizeListing({
      ...sampleListing(),
      tags: ["only one"],
    });
    assert.equal(result.ok, false);
  });

  test("clears the session on logout", async () => {
    const response = await logout();
    const header = setCookieHeader(response);
    assert.equal(response.status, 200);
    assert.match(header, /session_token=/);
    assert.match(header, /Max-Age=0/);
    assert.match(header, /HttpOnly/i);
  });

  test("limits repeated login attempts", async () => {
    process.env.LOGIN_RATE_LIMIT_MAX = "2";
    assert.equal((await login(loginRequest("missing-1"))).status, 401);
    assert.equal((await login(loginRequest("missing-2"))).status, 401);
    assert.equal((await login(loginRequest("missing-3"))).status, 429);
  });
});
