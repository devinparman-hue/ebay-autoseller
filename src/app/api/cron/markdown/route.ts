import { NextResponse, type NextRequest } from "next/server";
import { applyMarkdowns, computeMarkdowns } from "@/lib/markdown";

export const runtime = "nodejs";

/**
 * Auth check.
 *  - If CRON_SECRET is set, require `Authorization: Bearer <secret>`.
 *  - If unset, allow anyone (dev mode). In production set the env var.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/** GET → dry run: preview what a markdown would do. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const planned = await computeMarkdowns();
  return NextResponse.json({ planned });
}

/** POST → apply the weekly markdown. Idempotent if called twice within a week. */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const applied = await applyMarkdowns();
  return NextResponse.json({ applied: applied.length, changes: applied });
}
