import { NextResponse } from "next/server";
import { getEbayConfig, getStoredTokens } from "@/lib/ebay";

/**
 * Diagnostic: report the state of the ebay_tokens row for the current env.
 * Used to debug "I just linked but status says Not linked" — tells us
 * whether the row exists, has real values, and what env partition it's in,
 * without exposing the actual token strings.
 *
 * TODO: remove once OAuth round-trip is verified.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let env: string | null = null;
  try {
    env = getEbayConfig().env;
  } catch (err) {
    return NextResponse.json(
      {
        error: "config_failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 }
    );
  }

  try {
    const tokens = await getStoredTokens();
    if (!tokens) {
      return NextResponse.json({
        env,
        hasRow: false,
        message:
          "No row in ebay_tokens for this env. Either the OAuth callback " +
          "never ran, or saveTokens silently failed.",
      });
    }
    // Don't echo the tokens themselves — just lengths and metadata so we
    // can tell if they're real (non-empty) and not expired.
    return NextResponse.json({
      env,
      hasRow: true,
      accessTokenLength: tokens.accessToken.length,
      refreshTokenLength: tokens.refreshToken.length,
      expiresAt: tokens.expiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
      accessExpiresInSec: Math.round(
        (new Date(tokens.expiresAt).getTime() - Date.now()) / 1000
      ),
      refreshExpiresInSec: Math.round(
        (new Date(tokens.refreshExpiresAt).getTime() - Date.now()) / 1000
      ),
      scopes: tokens.scopes,
    });
  } catch (err) {
    return NextResponse.json(
      {
        env,
        error: "get_tokens_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
