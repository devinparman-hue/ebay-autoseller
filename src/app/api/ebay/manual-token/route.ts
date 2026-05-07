import { NextResponse, type NextRequest } from "next/server";
import { saveTokens, getEbayConfig, EBAY_SCOPES } from "@/lib/ebay";

/**
 * Manual token paste endpoint — accepts tokens pasted from eBay's developer
 * portal User Token Tool, validates them by making a test Sell API call,
 * and stores them in the ebay_tokens table. This is an alternative to the
 * OAuth handshake at /api/ebay/connect → /api/ebay/callback for cases where
 * the redirect-based flow can't be completed (RuName config issues, IP-level
 * rate limiting, sandbox test-user setup hassles, etc.).
 *
 * Body shape (JSON):
 *   {
 *     accessToken:        string,
 *     refreshToken:       string,
 *     expiresIn:          number,   // seconds, from eBay's response
 *     refreshExpiresIn?:  number,   // seconds, default ~18 months for User tokens
 *     scopes?:            string,   // space-delimited; defaults to our app's scopes
 *   }
 *
 * Returns 200 with `{ ok: true, validation }` on success, or 4xx with a
 * descriptive error otherwise. Validation makes a single GET to a cheap
 * Sell API endpoint to confirm the token is actually valid before saving.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresIn?: unknown;
  refreshExpiresIn?: unknown;
  scopes?: unknown;
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

  const accessToken =
    typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const refreshToken =
    typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
  const expiresIn = Number(body.expiresIn);
  const refreshExpiresIn =
    body.refreshExpiresIn !== undefined && body.refreshExpiresIn !== ""
      ? Number(body.refreshExpiresIn)
      : // eBay User refresh tokens default to 18 months. Use that as a safe
        // fallback so we don't refuse otherwise-valid pastes.
        60 * 60 * 24 * 30 * 18;
  const scopes =
    typeof body.scopes === "string" && body.scopes.trim().length > 0
      ? body.scopes.trim()
      : EBAY_SCOPES.join(" ");

  if (!accessToken) {
    return NextResponse.json(
      { error: "missing_access_token" },
      { status: 400 }
    );
  }
  if (!refreshToken) {
    return NextResponse.json(
      { error: "missing_refresh_token" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    return NextResponse.json(
      {
        error: "invalid_expires_in",
        detail:
          "expiresIn must be the number of seconds the access token is valid for.",
      },
      { status: 400 }
    );
  }

  // Validate by calling a cheap Sell API endpoint. 200 = good, 401 = bad.
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

  const validateRes = await fetch(
    `${cfg.apiHost}/sell/account/v1/privilege`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (!validateRes.ok) {
    const text = await validateRes.text();
    return NextResponse.json(
      {
        error: "token_validation_failed",
        httpStatus: validateRes.status,
        detail: text.slice(0, 500),
      },
      { status: 400 }
    );
  }

  const now = Date.now();
  const tokens = {
    accessToken,
    refreshToken,
    expiresAt: new Date(now + expiresIn * 1000).toISOString(),
    refreshExpiresAt: new Date(
      now + refreshExpiresIn * 1000
    ).toISOString(),
    scopes,
  };

  try {
    await saveTokens(tokens);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "save_failed", detail: message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    env: cfg.env,
    expiresAt: tokens.expiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
  });
}
