import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "../license/crypto";
import { consumeGenerationRate, requireLicenseToken } from "../license/guard";
import { getListingGenerator, toGenerateInput } from "../listing/generator";
import { MAX_IMAGES, normalizeListing } from "../listing/schema";

// One buyer action consumes one rate-limit slot.
// If the model output is incomplete, Gemini may be called once more inside that same slot.
const MAX_MODEL_ATTEMPTS = 2;

type RequestBody = {
  images?: unknown;
  keyword?: unknown;
};

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
      console.error("Error in /api/generate:", error instanceof Error ? error.name : "unknown");
      return NextResponse.json({ error: "予期せぬエラーが発生しました。" }, { status: 500 });
    }

    const normalized = normalizeListing(generated);
    if (normalized.ok) {
      return NextResponse.json(normalized.value);
    }
    validationError = normalized.error;
  }

  return NextResponse.json({ error: validationError }, { status: 422 });
}
