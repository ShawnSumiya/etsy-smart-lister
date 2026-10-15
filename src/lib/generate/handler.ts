import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "../license/crypto";
import { consumeGenerationRate, requireLicenseToken } from "../license/guard";
import { getListingGenerator, toGenerateInput } from "../listing/generator";
import { MAX_IMAGES, normalizeListing } from "../listing/schema";

// One buyer action consumes one rate-limit slot and may call Gemini at most twice.
// The second call is shared by invalid JSON/SEO output and one transient Gemini failure.
const MAX_MODEL_ATTEMPTS = 2;
// Stay well under Vercel's function limit. A generation itself can take tens of seconds,
// so the pause before a retry must stay short enough that two calls can still finish.
const MAX_TRANSIENT_WAIT_MS = 1000;
const TRANSIENT_BACKOFF_MS = 250;
const RETRYABLE_UPSTREAM_STATUS = new Set([500, 503, 504]);
const TRANSIENT_NETWORK_ERRORS = new Set([
  "GoogleGenerativeAIError",
  "GoogleGenerativeAIAbortError",
  "TypeError",
]);
const LONG_LIVED_QUOTA_REASONS = new Set([
  "RESOURCE_EXHAUSTED",
  "QUOTA_EXCEEDED",
  "DAILY_QUOTA_EXCEEDED",
]);

type RequestBody = {
  images?: unknown;
  keyword?: unknown;
};

type GenerateFailure = {
  httpStatus: 422 | 429 | 500 | 502;
  code: string;
  message: string;
  logDetail: string;
};

function readUpstreamStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = error.status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function readStatusText(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("statusText" in error)) return null;
  const statusText = error.statusText;
  return typeof statusText === "string" && /^[A-Za-z][A-Za-z ]{0,40}$/.test(statusText) ? statusText : null;
}

function readSafeReasons(error: unknown): string[] {
  if (!error || typeof error !== "object" || !("errorDetails" in error)) return [];
  const details = error.errorDetails;
  if (!Array.isArray(details)) return [];
  const reasons: string[] = [];
  for (const detail of details) {
    if (!detail || typeof detail !== "object" || !("reason" in detail)) continue;
    const reason = detail.reason;
    if (typeof reason === "string" && /^[A-Z0-9_]{1,64}$/.test(reason)) reasons.push(reason);
  }
  return reasons;
}

export function classifyGenerateError(error: unknown): GenerateFailure {
  const name = error instanceof Error ? error.constructor.name : "unknown";
  const upstreamStatus = readUpstreamStatus(error);
  const statusText = readStatusText(error);
  const reasons = readSafeReasons(error);
  const logDetail = [
    `name=${name}`,
    `upstreamStatus=${upstreamStatus ?? "none"}`,
    `upstreamStatusText=${statusText ?? "none"}`,
    `reason=${reasons.length > 0 ? reasons.join(",") : "none"}`,
  ].join(" ");

  if (error instanceof Error && error.message === "GEMINI_API_KEY is not set") {
    return {
      httpStatus: 500,
      code: "gemini_not_configured",
      message: "生成サービスが一時的に利用できません。",
      logDetail,
    };
  }
  if (error instanceof SyntaxError) {
    return {
      httpStatus: 422,
      code: "invalid_output",
      message: "生成結果の形式が不正です。",
      logDetail,
    };
  }
  if (upstreamStatus === 401) {
    return {
      httpStatus: 502,
      code: "gemini_unauthorized",
      message: "生成サービスが一時的に利用できません。",
      logDetail,
    };
  }
  if (upstreamStatus === 403) {
    return {
      httpStatus: 502,
      code: "gemini_forbidden",
      message: "生成サービスがこのリクエストを拒否しました。",
      logDetail,
    };
  }
  if (upstreamStatus === 429) {
    return {
      httpStatus: 429,
      code: "gemini_rate_limited",
      message: "生成サービスが混み合っています。しばらく待ってから再度お試しください。",
      logDetail,
    };
  }
  if (upstreamStatus !== null && upstreamStatus >= 400 && upstreamStatus < 500) {
    return {
      httpStatus: 422,
      code: "gemini_bad_request",
      message: "生成リクエストを処理できませんでした。入力を変えて再度お試しください。",
      logDetail,
    };
  }
  if (upstreamStatus !== null && upstreamStatus >= 500) {
    return {
      httpStatus: 502,
      code: "gemini_unavailable",
      message: "生成サービスが一時的に利用できません。",
      logDetail,
    };
  }
  return {
    httpStatus: 500,
    code: "unexpected",
    message: "予期せぬエラーが発生しました。",
    logDetail,
  };
}

function parseDelayMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 1000);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const duration = /^(\d+(?:\.\d+)?)s$/.exec(trimmed);
  if (duration) return Math.round(Number(duration[1]) * 1000);
  if (!/^(?:\w{3}, )?\d{1,2} \w{3} \d{4} /.test(trimmed)) return null;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

function readHeader(error: object, name: string): unknown {
  if (!("headers" in error)) return null;
  const headers = error.headers;
  if (!headers || typeof headers !== "object") return null;
  if ("get" in headers && typeof headers.get === "function") {
    return headers.get(name);
  }
  const record = headers as Record<string, unknown>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

function readRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const direct = parseDelayMs("retryAfter" in error ? error.retryAfter : null);
  if (direct !== null) return direct;
  const header = parseDelayMs(readHeader(error, "retry-after"));
  if (header !== null) return header;
  if (!("errorDetails" in error) || !Array.isArray(error.errorDetails)) return null;
  for (const detail of error.errorDetails) {
    if (!detail || typeof detail !== "object" || !("retryDelay" in detail)) continue;
    const delay = parseDelayMs(detail.retryDelay);
    if (delay !== null) return delay;
  }
  return null;
}

function transientRetryDelayMs(error: unknown, failure: GenerateFailure): number | null {
  if (failure.code === "gemini_not_configured" || failure.code === "invalid_output") return null;
  const upstreamStatus = readUpstreamStatus(error);
  if (upstreamStatus === 429) {
    if (readSafeReasons(error).some((reason) => LONG_LIVED_QUOTA_REASONS.has(reason))) return null;
    const delay = readRetryAfterMs(error);
    if (delay === null || delay > MAX_TRANSIENT_WAIT_MS) return null;
    return delay;
  }
  if (upstreamStatus !== null) {
    return RETRYABLE_UPSTREAM_STATUS.has(upstreamStatus) ? TRANSIENT_BACKOFF_MS : null;
  }
  const name = error instanceof Error ? error.constructor.name : "";
  return TRANSIENT_NETWORK_ERRORS.has(name) ? TRANSIENT_BACKOFF_MS : null;
}

function waitForRetry(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleGenerate(req: NextRequest): Promise<NextResponse> {
  const access = await requireLicenseToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!access.ok) {
    return NextResponse.json({ error: access.message, code: access.code }, { status: access.status });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  if (body.keyword != null && typeof body.keyword !== "string") {
    return NextResponse.json({ error: "keyword の形式が不正です。" }, { status: 400 });
  }
  if (body.images != null && !Array.isArray(body.images)) {
    return NextResponse.json({ error: "images の形式が不正です。" }, { status: 400 });
  }

  const images = Array.isArray(body.images) ? body.images.filter((image): image is string => typeof image === "string") : [];
  if (Array.isArray(body.images) && body.images.some((image) => typeof image !== "string")) {
    return NextResponse.json({ error: "images の形式が不正です。" }, { status: 400 });
  }
  if (!keyword && images.length === 0) {
    return NextResponse.json(
      { error: "images または keyword のいずれかは必須です。" },
      { status: 400 }
    );
  }
  if (images.length > MAX_IMAGES) {
    return NextResponse.json({ error: "画像は10枚以内にしてください。" }, { status: 400 });
  }

  const rate = await consumeGenerationRate(access.license.id);
  if (!rate.ok) {
    return NextResponse.json({ error: rate.message, code: rate.code }, { status: rate.status });
  }

  const generateInput = toGenerateInput(keyword, images);
  let validationError = "生成結果の形式が不正です。";
  for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt += 1) {
    let generated: unknown;
    try {
      generated = await getListingGenerator()(generateInput);
    } catch (error) {
      const failure = classifyGenerateError(error);
      const canRetry = attempt < MAX_MODEL_ATTEMPTS - 1;
      if (canRetry && failure.code === "invalid_output") {
        validationError = failure.message;
        continue;
      }
      const delay = canRetry ? transientRetryDelayMs(error, failure) : null;
      if (delay !== null) {
        await waitForRetry(delay);
        continue;
      }
      console.error("Error in /api/generate:", `${failure.logDetail} attempts=${attempt + 1}`);
      return NextResponse.json(
        { error: failure.message, code: failure.code },
        { status: failure.httpStatus }
      );
    }

    const normalized = normalizeListing(generated);
    if (normalized.ok) {
      return NextResponse.json(normalized.value);
    }
    validationError = normalized.error;
  }

  return NextResponse.json({ error: validationError }, { status: 422 });
}
