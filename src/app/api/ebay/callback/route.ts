import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  EBAY_OAUTH_STATE_COOKIE,
  exchangeCodeForTokens,
  saveTokens,
} from "@/lib/ebay";

/**
 * OAuth callback endpoint. eBay redirects the user here after they consent
 * (via the RuName registered in the dev portal).
 *
 * Query params from eBay:
 *   ?code=<authorization_code>   — on success
 *   ?state=<state>               — echoed back; must match our cookie
 *   ?error=<err>&error_description=<…>  — on failure / user cancel
 *
 * On success we exchange the code for tokens, persist them, clear the state
 * cookie, and bounce the user back to /inventory with a ?linked=1 flag.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const oauthErrorDescription = url.searchParams.get("error_description");

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(EBAY_OAUTH_STATE_COOKIE)?.value;

  // Always clear the state cookie before returning — it's single-use.
  const clearStateCookie = () => {
    cookieStore.set(EBAY_OAUTH_STATE_COOKIE, "", {
      path: "/api/ebay",
      maxAge: 0,
    });
  };

  const inventoryUrl = (query: string) =>
    new URL(`/inventory?${query}`, url.origin);

  // User cancelled or eBay rejected the request.
  if (oauthError) {
    clearStateCookie();
    const q =
      `ebay_error=${encodeURIComponent(oauthError)}` +
      (oauthErrorDescription
        ? `&ebay_error_description=${encodeURIComponent(oauthErrorDescription)}`
        : "");
    return NextResponse.redirect(inventoryUrl(q), { status: 303 });
  }

  if (!code || !state) {
    clearStateCookie();
    return NextResponse.redirect(
      inventoryUrl("ebay_error=missing_code_or_state"),
      { status: 303 }
    );
  }

  if (!stateCookie || stateCookie !== state) {
    // Either the cookie expired (took >10 min on eBay's consent page) or
    // someone's trying to CSRF us. Either way, refuse.
    clearStateCookie();
    return NextResponse.redirect(inventoryUrl("ebay_error=state_mismatch"), {
      status: 303,
    });
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    clearStateCookie();
    const message = err instanceof Error ? err.message : "Unknown error";
    const q =
      `ebay_error=token_exchange_failed` +
      `&ebay_error_description=${encodeURIComponent(message)}`;
    return NextResponse.redirect(inventoryUrl(q), { status: 303 });
  }

  try {
    await saveTokens(tokens);
  } catch (err) {
    clearStateCookie();
    const message = err instanceof Error ? err.message : "Unknown error";
    const q =
      `ebay_error=save_tokens_failed` +
      `&ebay_error_description=${encodeURIComponent(message)}`;
    return NextResponse.redirect(inventoryUrl(q), { status: 303 });
  }

  clearStateCookie();
  return NextResponse.redirect(inventoryUrl("linked=1"), { status: 303 });
}
