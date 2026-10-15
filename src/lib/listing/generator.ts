import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildImageParts, SYSTEM_INSTRUCTION, type ImagePart } from "./schema";

export type GenerateInput = {
  keyword: string;
  imageParts: ImagePart[];
};

export type ListingGenerator = (input: GenerateInput) => Promise<unknown>;

let generatorOverride: ListingGenerator | null = null;

export function setListingGeneratorForTests(generator: ListingGenerator | null) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Listing generator override is disabled in production");
  }
  generatorOverride = generator;
}

export function getListingGenerator(): ListingGenerator {
  return generatorOverride ?? generateWithGemini;
}

let installedFetch: typeof fetch | null = null;
let fetchUsers = 0;

function isRetryAfterValue(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  if (/^\d+(?:\.\d+)?$/.test(value)) return true;
  if (/^\d+(?:\.\d+)?s$/.test(value)) return true;
  return /^(?:\w{3}, )?\d{1,2} \w{3} \d{4} /.test(value);
}

// The Gemini SDK drops the HTTP Retry-After header. Keep that value in the
// JSON error details so the handler can decide whether a 429 will recover soon.
export async function embedRetryAfter(response: Response): Promise<Response> {
  if (response.status !== 429) return response;
  const retryAfter = response.headers.get("retry-after")?.trim() ?? "";
  if (!isRetryAfterValue(retryAfter)) return response;

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  if (!payload || typeof payload !== "object" || !("error" in payload)) return response;
  const error = payload.error;
  if (!error || typeof error !== "object") return response;
  const record = error as { details?: unknown };
  const details = Array.isArray(record.details) ? record.details : [];
  if (details.some((detail) => detail && typeof detail === "object" && "retryDelay" in detail)) {
    return response;
  }
  record.details = [...details, { retryDelay: retryAfter }];
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function geminiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const base = installedFetch ?? globalThis.fetch;
  return embedRetryAfter(await base(input, init));
}

async function withGeminiFetch(action: () => Promise<void>): Promise<void> {
  if (fetchUsers === 0) {
    installedFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = geminiFetch;
  }
  fetchUsers += 1;
  try {
    return await action();
  } finally {
    fetchUsers -= 1;
    if (fetchUsers === 0 && installedFetch) {
      globalThis.fetch = installedFetch;
      installedFetch = null;
    }
  }
}

async function generateWithGemini(input: GenerateInput): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const userPromptLines: string[] = [];
  if (input.keyword) {
    userPromptLines.push(`日本語で与えられた商品の特徴・キーワード: ${input.keyword}`);
  }
  if (input.imageParts.length > 0) {
    userPromptLines.push(
      "添付された複数の商品画像から特徴・素材・カラー・テイスト・利用シーン、バリエーションやセット内容なども推測し、テキスト情報と組み合わせて最適な出品データを作成してください。"
    );
  }
  userPromptLines.push(
    "Etsy の検索トレンドや購買意欲を高める自然な英語表現を意識し、事実と異なる表現や誇大広告は避けてください。title は140文字以内、tags はちょうど13個で各20文字以内、xPost と instagramPost は別々の文章にしてください。出力は指定された JSON 構造のみで返してください。"
  );

  let text = "";
  await withGeminiFetch(async () => {
    const result = await model.generateContent([userPromptLines.join("\n"), ...input.imageParts]);
    text = result.response.text();
  });
  return JSON.parse(text) as unknown;
}

export function toGenerateInput(keyword: string, images: string[]): GenerateInput {
  return {
    keyword,
    imageParts: buildImageParts(images),
  };
}
