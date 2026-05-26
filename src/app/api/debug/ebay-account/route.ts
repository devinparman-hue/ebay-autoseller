import { NextResponse } from "next/server";
import { getEbayConfig, getValidAccessToken } from "@/lib/ebay";

/**
 * Diagnostic: report the linked eBay account's selling readiness via
 * /sell/account/v1/privilege. Key fields:
 *   - sellerRegistrationCompleted: bool. False means the account isn't
 *     set up as a seller at all (just a buyer).
 *   - sellingLimit: { quantity, amount }. The monthly limits eBay grants.
 *   - (we surface the whole body so any other useful fields are visible)
 *
 * Tells us in one shot whether the payment-policy 500 is because the
 * linked account isn't a fully-onboarded seller (managed payments,
 * registration, etc.) versus an eBay-side flake.
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

  const res = await fetch(`${cfg.apiHost}/sell/account/v1/privilege`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

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
    privilege: body,
  });
}
