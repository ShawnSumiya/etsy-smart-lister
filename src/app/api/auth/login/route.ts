import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "../../../../lib/license/crypto";
import { consumeLoginAttempt, loginWithLicenseKey } from "../../../../lib/license/guard";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  if (!consumeLoginAttempt(ip)) {
    return NextResponse.json(
      {
        error: "ログイン試行が多すぎます。しばらく待ってから再度お試しください。",
        code: "rate_limited",
      },
      { status: 429 }
    );
  }

  let licenseKey = "";
  try {
    const body = (await req.json()) as { licenseKey?: unknown };
    if (typeof body.licenseKey === "string") licenseKey = body.licenseKey;
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です。" }, { status: 400 });
  }

  const result = await loginWithLicenseKey(licenseKey);
  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  }

  const response = NextResponse.json({ ok: true, expiresAt: result.expiresAt });
  response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.maxAge));
  return response;
}
