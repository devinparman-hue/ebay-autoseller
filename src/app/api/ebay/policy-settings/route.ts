import { NextResponse, type NextRequest } from "next/server";
import {
  getListingDefaults,
  updateListingDefaults,
  EbayApiError,
} from "@/lib/ebay-sell";

/**
 * Read/update the shared listing defaults (shipping + returns policies).
 * Thin HTTP shim over getListingDefaults / updateListingDefaults — see
 * src/lib/ebay-sell.ts for why this lives in the app instead of eBay's
 * own (broken-for-this-account) policy UI.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(err: unknown) {
  if (err instanceof EbayApiError) {
    return NextResponse.json(
      { error: "ebay_api_error", status: err.status, path: err.path, detail: err.body },
      { status: 502 }
    );
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const defaults = await getListingDefaults();
    return NextResponse.json({ defaults });
  } catch (err) {
    return errorResponse(err);
  }
}

const RETURN_PERIODS = [14, 30, 60];

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const shippingCostUsd = Number(body.shippingCostUsd);
  const freeShipping = body.freeShipping === true;
  const handlingTimeDays = Number(body.handlingTimeDays);
  const returnsAccepted = body.returnsAccepted === true;
  const returnPeriodDays = Number(body.returnPeriodDays);

  if (!freeShipping && (!Number.isFinite(shippingCostUsd) || shippingCostUsd < 0)) {
    return NextResponse.json(
      { error: "invalid_shipping_cost", detail: "Shipping cost must be 0 or more." },
      { status: 400 }
    );
  }
  if (!Number.isInteger(handlingTimeDays) || handlingTimeDays < 0 || handlingTimeDays > 30) {
    return NextResponse.json(
      { error: "invalid_handling_time", detail: "Handling time must be 0–30 days." },
      { status: 400 }
    );
  }
  if (returnsAccepted && !RETURN_PERIODS.includes(returnPeriodDays)) {
    return NextResponse.json(
      { error: "invalid_return_period", detail: "Return period must be 14, 30, or 60 days." },
      { status: 400 }
    );
  }

  try {
    await updateListingDefaults({
      shippingCostUsd: freeShipping ? 0 : shippingCostUsd,
      freeShipping,
      handlingTimeDays,
      returnsAccepted,
      returnPeriodDays,
    });
    const defaults = await getListingDefaults();
    return NextResponse.json({ ok: true, defaults });
  } catch (err) {
    return errorResponse(err);
  }
}
