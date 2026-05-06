import { NextResponse } from "next/server";
import { authorizeUrl, getEbayConfig } from "@/lib/ebay";

/**
 * Diagnostic: probe eBay's OAuth authorize URL from this server (so we
 * bypass any client-side rate limit on the user's IP) and report exactly
 * what eBay says about our App ID + RuName combination.
 *
 * If the App ID + RuName are valid, eBay returns a 302 redirect to its
 * sign-in page (Location: …signin.sandbox.ebay.com…). If the combination
 * is invalid, eBay returns a JSON error with `error_id` and a description.
 *
 * Uses `redirect: "manual"` so we capture the redirect Location header
 * instead of following it (we'd just get a sign-in HTML page, useless here).
 *
 * TODO: remove once OAuth works end-to-end.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let url: string;
  try {
    // Use a fixed state since this is server-to-server — no real CSRF.
    url = authorizeUrl("diagnostic_state");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "config_failed", detail: message },
      { status: 500 }
    );
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      // Some auth flows User-Agent sniff. Pretend to be a browser so we
      // get the same response a real user's browser would.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "fetch_failed", detail: message, authorizeUrl: url },
      { status: 500 }
    );
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // HTML or rate-limit text — keep first 1k chars
    body = text.slice(0, 1000);
  }

  // eBay should return either a 302 to a sign-in page (good) or a 4xx
  // with an error_id (config problem). Surface both clearly.
  const cfg = getEbayConfig();
  return NextResponse.json({
    authorizeUrl: url,
    httpStatus: res.status,
    locationHeader: res.headers.get("location"),
    contentType: res.headers.get("content-type"),
    body,
    // For comparison
    sentClientId: cfg.appId,
    sentRuName: cfg.ruName,
    sentScope: url.includes("scope=") ? "(see authorizeUrl)" : "(missing)",
  });
}
