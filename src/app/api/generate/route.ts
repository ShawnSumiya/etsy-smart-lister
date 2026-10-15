import { NextRequest } from "next/server";
import { handleGenerate } from "../../../lib/generate/handler";

export const runtime = "nodejs";

export function POST(req: NextRequest) {
  return handleGenerate(req);
}
