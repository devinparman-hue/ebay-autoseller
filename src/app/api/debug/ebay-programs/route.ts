import { NextResponse } from "next/server";
import { getEbayConfig, getValidAccessToken } from "@/lib/ebay";

/**
 * Diagnostic: which eBay seller programs is the linked account opted into?
 * Hits /sell/account/v1/program/get_opted_in_programs and surfaces the
 * full response. Key thing we're looking for: whether the
 * SELLING_POLICY_MANAGEMENT program is in the list (i.e., is the account
 * actually opted into Business Policies, the prerequisite for creating
 * payment/fulfillment/return policies via API).
 *
 * If it's missing, our API-driven opt-in (ensureBusinessPolicyOptIn) is
 * succeeding but not persisting — and the user needs to opt in manually
 * via eBay's seller hub UI.
 *
 * TODO: remove once production posting works end-to-end.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let cfg;
  let token: string;
  try {
    cfg = getEbayConfig();
    token = await getValidAccessToken();
  } catch (err) {
    return NextResponse.json(
      {
        error: "config_or_token_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 }
    );
  }

  const res = await fetch(
    `${cfg.apiHost}/sell/account/v1/program/get_opted_in_programs`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }
  );

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 500);
  }

  return NextResponse.json({
    env: cfg.env,
    httpStatus: res.status,
    ok: res.ok,
    optedInPrograms: body,
  });
}
