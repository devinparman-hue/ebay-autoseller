import { NextResponse, type NextRequest } from "next/server";
import { exchangeCodeForTokens, saveTokens } from "@/lib/ebay";

/**
 * Manual authorization-code exchange.
 *
 * Backstory: eBay's dev-portal form for our RuName silently refuses to
 * persist the auth-accepted URL, so after the user consents, eBay dumps
 * them on its own static "Authorization successfully completed" page
 * instead of redirecting to /api/ebay/callback. BUT the authorization code
 * is right there in that page's URL (?code=...&expires_in=299).
 *
 * So: the user copies the full URL from the address bar, pastes it here,
 * and we run the same code-for-tokens exchange the callback would have run.
 * This yields a full token pair INCLUDING the ~18-month refresh token —
 * after which getValidAccessToken() renews access tokens automatically and
 * the user never pastes anything again.
 *
 * Accepts either the full pasted URL or a bare code string. Codes are
 * single-use and expire ~5 minutes after consent, so paste promptly.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  redirectUrl?: unknown;
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", detail: "Body was not valid JSON." },
      { status: 400 }
    );
  }

  const raw =
    typeof body.redirectUrl === "string" ? body.redirectUrl.trim() : "";
  if (!raw) {
    return NextResponse.json(
      { error: "missing_redirect_url" },
      { status: 400 }
    );
  }

  let code: string | null = null;
  if (/^https?:\/\//i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return NextResponse.json(
        { error: "bad_url", detail: "Couldn't parse that as a URL." },
        { status: 400 }
      );
    }
    if (parsed.searchParams.get("isAuthSuccessful") === "false") {
      return NextResponse.json(
        {
          error: "auth_declined",
          detail:
            "That URL says the sign-in was declined or failed on eBay's side. " +
            "Start the sign-in again and click Agree.",
        },
        { status: 400 }
      );
    }
    // searchParams.get auto-decodes the percent-encoded code.
    code = parsed.searchParams.get("code");
  } else {
    // Bare code paste. If it still looks percent-encoded, decode it.
    code = raw.includes("%") ? decodeURIComponent(raw) : raw;
  }

  if (!code) {
    return NextResponse.json(
      {
        error: "no_code_in_url",
        detail:
          "No ?code= parameter found. Paste the ENTIRE URL from the browser " +
          "address bar on the 'Authorization successfully completed' page.",
      },
      { status: 400 }
    );
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        error: "exchange_failed",
        detail:
          message +
          " — note: codes are single-use and expire ~5 minutes after " +
          "consent. Redo the sign-in and paste the fresh URL promptly.",
      },
      { status: 502 }
    );
  }

  try {
    await saveTokens(tokens);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "save_failed", detail: message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    hasRefreshToken: tokens.refreshToken.length > 0,
    expiresAt: tokens.expiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  });
}
