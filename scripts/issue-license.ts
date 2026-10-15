import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { issueLicense } from "../src/lib/license/guard";

function loadLocalEnv() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadLocalEnv();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  if (!process.argv.includes("--confirm-issue")) {
    console.error("ライセンスはまだ発行しません。実行するには --confirm-issue が必要です。");
    console.error(
      "Usage: npx tsx scripts/issue-license.ts --buyer <coconala-trade-id> --months 1 --confirm-issue"
    );
    process.exit(1);
  }

  if (process.env.LICENSE_STORE === "memory") {
    console.error("メモリ上のストアには購入者キーを発行できません。");
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "SUPABASE_SERVICE_ROLE_KEY と、SUPABASE_URL または NEXT_PUBLIC_SUPABASE_URL を .env.local に設定してください。"
    );
    process.exit(1);
  }
  if (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    serviceRoleKey === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    console.error("SUPABASE_SERVICE_ROLE_KEY に anon key は使えません。");
    process.exit(1);
  }
  let supabaseHost = "";
  try {
    supabaseHost = new URL(supabaseUrl).host;
  } catch {
    console.error("Supabase の URL を解釈できません。");
    process.exit(1);
  }
  if (!supabaseHost.endsWith(".supabase.co")) {
    console.error("Supabase の接続先ホストが supabase.co ではありません。");
    process.exit(1);
  }

  const buyerId = arg("--buyer")?.trim();
  if (!buyerId) {
    console.error("--buyer にココナラ取引IDなどの購入者識別子を指定してください。");
    process.exit(1);
  }

  const daysArg = arg("--days");
  const monthsArg = arg("--months");
  if (daysArg !== undefined && monthsArg !== undefined) {
    console.error("--days と --months は同時に指定できません。");
    process.exit(1);
  }

  const issued = daysArg !== undefined
    ? await issueLicense({ buyerId, durationDays: Number(daysArg) })
    : await issueLicense({
        buyerId,
        months: monthsArg !== undefined ? Number(monthsArg) : 1,
      });

  console.log(
    JSON.stringify(
      {
        buyerId: issued.buyerId,
        validFrom: issued.validFrom,
        expiresAt: issued.expiresAt,
        licenseKey: issued.licenseKey,
      },
      null,
      2
    )
  );
  console.log("このキーは今回だけ表示されます。データベースにはハッシュだけを保存しています。");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "license issue failed");
  process.exit(1);
});
