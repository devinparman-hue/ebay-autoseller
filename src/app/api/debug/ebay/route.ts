import { NextResponse } from "next/server";
import { getEbayConfig } from "@/lib/ebay";

/**
 * Diagnostic: test whether the EBAY_APP_ID + EBAY_CERT_ID configured on
 * this server actually work with eBay's API. Uses the application token
 * endpoint (`grant_type=client_credentials`), which is server-to-server
 * and does NOT involve the user OAuth flow — so we can verify keyset
 * config independently of the user's browser, even when their IP is
 * rate-limited at eBay's edge.
 *
 * Reveals the App ID and RuName (not secrets — App ID is like a username,
 * RuName is a public identifier). Never reveals the Cert ID.
 *
 * TODO: remove once OAuth is verified working end-to-end.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let cfg;
  try {
    cfg = getEbayConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "config_failed", detail: message },
      { status: 500 }
    );
  }

  const basic = Buffer.from(`${cfg.appId}:${cfg.certId}`, "utf8").toString(
    "base64"
  );
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });

  let res: Response;
  try {
    res = await fetch(`${cfg.apiHost}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "fetch_failed", detail: message },
      { status: 500 }
    );
  }

  // eBay's auth errors come back as JSON, but rate limit / WAF blocks may
  // return text. Try JSON first, fall back to raw text.
  let ebayResponse: unknown;
  const text = await res.text();
  try {
    ebayResponse = JSON.parse(text);
  } catch {
    ebayResponse = text.slice(0, 500);
  }

  return NextResponse.json({
    httpStatus: res.status,
    ok: res.ok,
    env: cfg.env,
    apiHost: cfg.apiHost,
    appId: cfg.appId, // not secret
    appIdLength: cfg.appId.length,
    appIdHasWhitespace: cfg.appId.trim() !== cfg.appId,
    certIdLength: cfg.certId.length,
    certIdHasWhitespace: cfg.certId.trim() !== cfg.certId,
    ruName: cfg.ruName,
    ruNameLength: cfg.ruName.length,
    ruNameHasWhitespace: cfg.ruName.trim() !== cfg.ruName,
    ebayResponse,
  });
}
