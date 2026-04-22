import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authorizeUrl, EBAY_OAUTH_STATE_COOKIE } from "@/lib/ebay";

/**
 * Kick off the eBay OAuth flow.
 *
 * Flow:
 *   1. Generate a random `state` token (CSRF)
 *   2. Set it as an httpOnly cookie scoped to /api/ebay
 *   3. Redirect the user to eBay's authorize URL with that same state
 *
 * When eBay redirects back to our RuName (which points at /api/ebay/callback),
 * we compare the `state` query param to the cookie — if they match, we know
 * the callback really originated from our /connect request.
 *
 * Why a cookie instead of a server-side session? We don't have sessions yet.
 * The whole flow lives inside one browser, so a short-lived cookie is enough.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // 32 random bytes → 43-char base64url. Plenty of entropy for CSRF.
  const state = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");

  const cookieStore = await cookies();
  cookieStore.set(EBAY_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Scope to /api/ebay so it's available on /callback but not sent with
    // every unrelated request.
    path: "/api/ebay",
    // 10 minutes — plenty of time to sign in on eBay, short enough that a
    // forgotten tab doesn't leave a stale state cookie around.
    maxAge: 10 * 60,
  });

  // Build the authorize URL with the same state.
  let url: string;
  try {
    url = authorizeUrl(state);
  } catch (err) {
    // Env vars missing, bad EBAY_ENV, etc. Show the user something readable
    // instead of a generic 500.
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "eBay not configured", detail: message },
      { status: 500 }
    );
  }

  return NextResponse.redirect(url, { status: 302 });
}
