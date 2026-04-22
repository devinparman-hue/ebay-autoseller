import { NextResponse } from "next/server";

/**
 * Diagnostic endpoint: reports which env vars the running server CAN see.
 *
 * Returns booleans only (never the values themselves), so it's safe to hit
 * from curl or the browser. Used to diagnose "env vars look right in the
 * Vercel UI but runtime doesn't see them" problems.
 *
 * TODO: remove once eBay OAuth is wired up end-to-end.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRACKED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "EBAY_ENV",
  "EBAY_APP_ID",
  "EBAY_DEV_ID",
  "EBAY_CERT_ID",
  "EBAY_RU_NAME",
  "CRON_SECRET",
  "VERCEL_ENV",
  "NODE_ENV",
] as const;

export async function GET() {
  const presence: Record<string, boolean | string> = {};
  for (const key of TRACKED) {
    const val = process.env[key];
    if (key === "VERCEL_ENV" || key === "NODE_ENV" || key === "EBAY_ENV") {
      // These aren't secret — echo the value so we can confirm which
      // environment the running function thinks it's in.
      presence[key] = val ?? "(unset)";
    } else {
      presence[key] = typeof val === "string" && val.length > 0;
    }
  }
  return NextResponse.json(presence);
}
