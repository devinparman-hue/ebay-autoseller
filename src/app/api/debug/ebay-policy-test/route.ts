import { NextResponse } from "next/server";
import { getEbayConfig, getValidAccessToken } from "@/lib/ebay";

/**
 * Instrumented probe for the payment-policy 500 mystery.
 *
 * Theory under test: our Content-Language header used the underscore form
 * ("en_US") instead of BCP-47 ("en-US"), which some Sell endpoints tolerate
 * (fulfillment create worked) and others reject with an opaque 500 + empty
 * errors[] (payment create — the exact failure we keep seeing in both
 * sandbox and production).
 *
 * What this does, sequentially:
 *   1. Lists all three policy types + the "default" inventory location —
 *      shows what actually exists (including any ghost policies created
 *      during earlier retries).
 *   2. Creates a return policy with the corrected header (control: proves
 *      whether non-payment POSTs work).
 *   3. Creates a payment policy with the corrected header (the real test).
 *   4. If (3) still 5xxs, retries it with NO Content-Language header.
 *
 * Every call captures status, x-ebay-c-request-id, rlogid, and the raw
 * body. Skips creates when the list already shows a policy of that type.
 * Policies created here are the same ones the real Post flow needs, so a
 * success doubles as the repair.
 *
 * TODO: remove once production posting works end-to-end.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MARKETPLACE = "EBAY_US";
const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

interface CallResult {
  label: string;
  method: string;
  path: string;
  status: number;
  requestId: string | null;
  rlogid: string | null;
  body: unknown;
}

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
        hint: "If the token expired, re-paste a fresh one at /settings/ebay first.",
      },
      { status: 500 }
    );
  }

  const results: CallResult[] = [];

  const call = async (
    label: string,
    method: string,
    path: string,
    body?: unknown,
    contentLanguage?: string | null
  ): Promise<CallResult> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // null = deliberately omit; undefined = default to the corrected form.
    if (contentLanguage !== null) {
      headers["Content-Language"] = contentLanguage ?? "en-US";
      headers["Accept-Language"] = contentLanguage ?? "en-US";
    }
    const res = await fetch(`${cfg.apiHost}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text.slice(0, 800);
    }
    const result: CallResult = {
      label,
      method,
      path,
      status: res.status,
      requestId: res.headers.get("x-ebay-c-request-id"),
      rlogid: res.headers.get("rlogid"),
      body: parsed,
    };
    results.push(result);
    return result;
  };

  const q = `marketplace_id=${MARKETPLACE}`;

  // 1. What exists right now?
  const fulfillmentList = await call(
    "list fulfillment policies",
    "GET",
    `/sell/account/v1/fulfillment_policy?${q}`
  );
  const paymentList = await call(
    "list payment policies",
    "GET",
    `/sell/account/v1/payment_policy?${q}`
  );
  const returnList = await call(
    "list return policies",
    "GET",
    `/sell/account/v1/return_policy?${q}`
  );
  await call(
    "get inventory location 'default'",
    "GET",
    "/sell/inventory/v1/location/default"
  );

  const listCount = (r: CallResult, key: string): number => {
    const b = r.body as Record<string, unknown> | string;
    if (typeof b !== "object" || b === null) return 0;
    const arr = b[key];
    return Array.isArray(arr) ? arr.length : 0;
  };

  // 2. Control: return-policy create with corrected header (skip if exists).
  if (listCount(returnList, "returnPolicies") === 0) {
    await call("create return policy (en-US header)", "POST", "/sell/account/v1/return_policy", {
      name: "Default Return",
      marketplaceId: MARKETPLACE,
      categoryTypes: CATEGORY_TYPES,
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: "DAY" },
      returnShippingCostPayer: "BUYER",
      returnMethod: "MONEY_BACK",
    });
  }

  // 3. The real test: payment-policy create with corrected header.
  if (listCount(paymentList, "paymentPolicies") === 0) {
    const attempt = await call(
      "create payment policy (en-US header)",
      "POST",
      "/sell/account/v1/payment_policy",
      {
        name: "Default Payment",
        marketplaceId: MARKETPLACE,
        categoryTypes: CATEGORY_TYPES,
      }
    );

    // 4. Fallback variant: omit Content-Language entirely.
    if (attempt.status >= 500) {
      await call(
        "create payment policy (no Content-Language header)",
        "POST",
        "/sell/account/v1/payment_policy",
        {
          name: "Default Payment",
          marketplaceId: MARKETPLACE,
          categoryTypes: CATEGORY_TYPES,
        },
        null
      );
    }
  }

  return NextResponse.json({
    env: cfg.env,
    note:
      "Existing-policy counts: " +
      `fulfillment=${listCount(fulfillmentList, "fulfillmentPolicies")}, ` +
      `payment=${listCount(paymentList, "paymentPolicies")}, ` +
      `return=${listCount(returnList, "returnPolicies")}`,
    results,
  });
}
