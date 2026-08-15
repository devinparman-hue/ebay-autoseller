import { NextResponse, type NextRequest } from "next/server";
import { syncEbayStatuses } from "@/lib/ebay-sell";

/**
 * Sync sold/ended status from eBay into our listings table.
 *
 * GET  → invoked by the daily Vercel cron (crons only issue GETs).
 * POST → the "Sync with eBay" button on /inventory.
 * Both run the same sync; it's idempotent (only touches "active" rows).
 *
 * Auth mirrors /api/cron/markdown: when CRON_SECRET is set, require the
 * Bearer header (Vercel cron sends it automatically); open otherwise.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function runSync() {
  try {
    const changes = await syncEbayStatuses();
    return NextResponse.json({ changes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message.slice(0, 300) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSync();
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSync();
}
