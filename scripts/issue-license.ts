import { issueLicense } from "../src/lib/license/guard";

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
