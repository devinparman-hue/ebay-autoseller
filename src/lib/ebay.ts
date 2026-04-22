import "server-only";
import { getSupabase } from "./supabase";

/**
 * eBay OAuth + Sell API helpers.
 *
 * Environment handling: eBay has two totally separate ecosystems — sandbox
 * (testing, fake buyers/sellers) and production (real money). Different
 * hostnames, different keysets. We flip between them with the `EBAY_ENV`
 * env var ("sandbox" or "production"). All URLs below derive from that.
 *
 * OAuth flow:
 *   1. User clicks "Link eBay" → /api/ebay/connect redirects to authorizeUrl()
 *   2. eBay prompts user to sign in + consent
 *   3. eBay redirects to our RuName (registered server-side URL) with ?code=…
 *   4. /api/ebay/callback exchanges the code for access + refresh tokens
 *   5. We store tokens in the ebay_tokens table keyed by env
 *
 * Subsequent API calls pull tokens via getValidAccessToken(), which refreshes
 * transparently if the access token is near expiry.
 */

export type EbayEnv = "sandbox" | "production";

export interface EbayConfig {
  env: EbayEnv;
  appId: string;
  devId: string;
  certId: string;
  ruName: string;
  /** e.g. https://auth.sandbox.ebay.com */
  authHost: string;
  /** e.g. https://api.sandbox.ebay.com */
  apiHost: string;
}

/**
 * OAuth scopes we request. `sell.inventory` is required to create listings;
 * `sell.account` is needed to read/write shipping, return, and payment
 * policies. Add more here as we grow — each addition re-prompts the user.
 */
export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
];

/** Cookie name we use to carry CSRF state across the OAuth round trip. */
export const EBAY_OAUTH_STATE_COOKIE = "ebay_oauth_state";

/**
 * Read eBay config out of the environment. Throws a helpful error if any of
 * the required vars are missing — this is the first place a mis-configured
 * deploy will fail, so the message matters.
 */
export function getEbayConfig(): EbayConfig {
  const env = (process.env.EBAY_ENV ?? "sandbox") as EbayEnv;
  if (env !== "sandbox" && env !== "production") {
    throw new Error(
      `EBAY_ENV must be "sandbox" or "production", got "${env}".`
    );
  }
  const appId = process.env.EBAY_APP_ID;
  const devId = process.env.EBAY_DEV_ID;
  const certId = process.env.EBAY_CERT_ID;
  const ruName = process.env.EBAY_RU_NAME;
  const missing: string[] = [];
  if (!appId) missing.push("EBAY_APP_ID");
  if (!devId) missing.push("EBAY_DEV_ID");
  if (!certId) missing.push("EBAY_CERT_ID");
  if (!ruName) missing.push("EBAY_RU_NAME");
  if (missing.length > 0) {
    throw new Error(
      `eBay not configured. Missing: ${missing.join(", ")}. ` +
        `Set them in .env.local (dev) or the Vercel dashboard (prod).`
    );
  }
  return {
    env,
    appId: appId!,
    devId: devId!,
    certId: certId!,
    ruName: ruName!,
    authHost:
      env === "sandbox"
        ? "https://auth.sandbox.ebay.com"
        : "https://auth.ebay.com",
    apiHost:
      env === "sandbox"
        ? "https://api.sandbox.ebay.com"
        : "https://api.ebay.com",
  };
}

/**
 * Build the authorize URL we redirect the user to when they click "Link eBay".
 * `state` is a random CSRF token we also set in a cookie; we verify it on
 * the callback. Note: `redirect_uri` here is the RuName *string*, not a URL
 * — eBay resolves RuNames server-side to the real callback URL. That's why
 * changing the Vercel deployment URL requires updating RuName config, not
 * this code.
 */
export function authorizeUrl(state: string): string {
  const cfg = getEbayConfig();
  const params = new URLSearchParams({
    client_id: cfg.appId,
    response_type: "code",
    redirect_uri: cfg.ruName,
    scope: EBAY_SCOPES.join(" "),
    state,
  });
  return `${cfg.authHost}/oauth2/authorize?${params.toString()}`;
}

/* ---------------------------- Token storage ---------------------------- */

const TOKENS_TABLE = "ebay_tokens";

interface TokenRow {
  id: string;
  env: EbayEnv;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
  scopes: string;
  created_at: string;
  updated_at: string;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp. */
  expiresAt: string;
  /** ISO timestamp. Typically ~18 months out. */
  refreshExpiresAt: string;
  scopes: string;
}

function rowToTokens(row: TokenRow): StoredTokens {
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    scopes: row.scopes,
  };
}

/** Load the stored tokens for the current env, or null if we haven't linked yet. */
export async function getStoredTokens(): Promise<StoredTokens | null> {
  const cfg = getEbayConfig();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TOKENS_TABLE)
    .select("*")
    .eq("env", cfg.env)
    .maybeSingle();
  if (error) throw new Error(`getStoredTokens: ${error.message}`);
  if (!data) return null;
  return rowToTokens(data as TokenRow);
}

/**
 * Upsert tokens for the current env. Keyed by `env` so re-linking just
 * replaces the row instead of accumulating stale tokens.
 */
export async function saveTokens(tokens: StoredTokens): Promise<void> {
  const cfg = getEbayConfig();
  const supabase = getSupabase();
  const { error } = await supabase.from(TOKENS_TABLE).upsert(
    {
      env: cfg.env,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
      refresh_expires_at: tokens.refreshExpiresAt,
      scopes: tokens.scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "env" }
  );
  if (error) throw new Error(`saveTokens: ${error.message}`);
}

/* -------------------------- Token exchange ----------------------------- */

/** Raw response shape from eBay's token endpoint. */
interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  token_type: "User Access Token" | string;
}

/** Basic auth header: base64("APP_ID:CERT_ID"). */
function basicAuth(): string {
  const cfg = getEbayConfig();
  const raw = `${cfg.appId}:${cfg.certId}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/**
 * Exchange the `code` from the OAuth callback for a full token pair.
 * Called exactly once per link — from /api/ebay/callback.
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<StoredTokens> {
  const cfg = getEbayConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.ruName,
  });
  const res = await fetch(`${cfg.apiHost}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `eBay token exchange failed (${res.status}): ${text.slice(0, 500)}`
    );
  }
  const json = (await res.json()) as TokenResponse;
  return tokenResponseToStored(json);
}

/**
 * Use the long-lived refresh token to mint a fresh access token. Does not
 * rotate the refresh token itself — that only changes when the user
 * re-consents (e.g. after we add a new scope, or every ~18 months).
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<StoredTokens> {
  const cfg = getEbayConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: EBAY_SCOPES.join(" "),
  });
  const res = await fetch(`${cfg.apiHost}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `eBay token refresh failed (${res.status}): ${text.slice(0, 500)}`
    );
  }
  const json = (await res.json()) as Partial<TokenResponse>;
  // Refresh responses omit refresh_token and refresh_token_expires_in —
  // fall back to the ones we already had. We reload the existing row so
  // we don't have to plumb the old values through every caller.
  const existing = await getStoredTokens();
  if (!existing) {
    throw new Error("refreshAccessToken: no stored tokens to merge into");
  }
  const now = Date.now();
  return {
    accessToken: json.access_token ?? existing.accessToken,
    refreshToken: json.refresh_token ?? existing.refreshToken,
    expiresAt: json.expires_in
      ? new Date(now + json.expires_in * 1000).toISOString()
      : existing.expiresAt,
    refreshExpiresAt: json.refresh_token_expires_in
      ? new Date(now + json.refresh_token_expires_in * 1000).toISOString()
      : existing.refreshExpiresAt,
    scopes: existing.scopes,
  };
}

/** Turn an initial token exchange response into our stored shape. */
function tokenResponseToStored(json: TokenResponse): StoredTokens {
  const now = Date.now();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(now + json.expires_in * 1000).toISOString(),
    refreshExpiresAt: new Date(
      now + json.refresh_token_expires_in * 1000
    ).toISOString(),
    scopes: EBAY_SCOPES.join(" "),
  };
}

/**
 * Return a valid access token, refreshing transparently if needed. This is
 * the function Sell API callers should use — never read `access_token`
 * directly off the row, or you'll hand out expired tokens.
 *
 * Throws if we've never linked, or if the refresh token itself has expired
 * (user needs to re-link in that case).
 */
export async function getValidAccessToken(): Promise<string> {
  const tokens = await getStoredTokens();
  if (!tokens) {
    throw new Error(
      "eBay not linked. Click 'Link eBay' on the inventory page first."
    );
  }
  // 60-second skew so we don't hand out a token that's about to die mid-request.
  const now = Date.now();
  const expiresAtMs = new Date(tokens.expiresAt).getTime();
  if (expiresAtMs - now > 60_000) {
    return tokens.accessToken;
  }
  // Access token is expired or nearly so — refresh.
  const refreshExpiresAtMs = new Date(tokens.refreshExpiresAt).getTime();
  if (refreshExpiresAtMs <= now) {
    throw new Error(
      "eBay refresh token expired. Click 'Link eBay' again to re-authorize."
    );
  }
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  await saveTokens(refreshed);
  return refreshed.accessToken;
}

/** True if we have any stored tokens for the current env. UI uses this. */
export async function isEbayLinked(): Promise<boolean> {
  try {
    const tokens = await getStoredTokens();
    return tokens !== null;
  } catch {
    // Env vars unset, DB down, etc. — report unlinked rather than crashing
    // the page. The Link button will then surface the real error.
    return false;
  }
}
