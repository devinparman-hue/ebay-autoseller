import Link from "next/link";
import { isEbayLinked, getStoredTokens } from "@/lib/ebay";
import EbayManualTokenForm from "./EbayManualTokenForm";

/**
 * eBay account settings. Two ways to link:
 *   1. OAuth flow — Link eBay button → /api/ebay/connect → eBay sign-in
 *      → /api/ebay/callback. Currently flaky depending on RuName setup;
 *      kept around because once it works, it's the lowest-friction path.
 *   2. Manual token paste — for when OAuth is blocked. User generates
 *      tokens via eBay's developer-portal User Token Tool, pastes them
 *      here, and we store them like we would after an OAuth callback.
 *
 * `isEbayLinked()` is wrapped here in a try/catch so a Supabase outage or
 * missing migration doesn't crash the settings page. (The /inventory page
 * was crashing on this; we now only render link state on a page where the
 * user came specifically to manage it.)
 */
export const dynamic = "force-dynamic";

export default async function EbaySettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const firstOf = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const linkedFlag = firstOf(params.linked) === "1";
  const ebayError = firstOf(params.ebay_error);
  const ebayErrorDescription = firstOf(params.ebay_error_description);

  let hasTokens = false;
  let tokenInfo: { expiresAt: string; refreshExpiresAt: string } | null = null;
  let tokenError: string | null = null;
  try {
    hasTokens = await isEbayLinked();
    if (hasTokens) {
      const t = await getStoredTokens();
      if (t) {
        tokenInfo = {
          expiresAt: t.expiresAt,
          refreshExpiresAt: t.refreshExpiresAt,
        };
      }
    }
  } catch (err) {
    tokenError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 pt-6 pb-28">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">eBay account</h1>
        <Link
          href="/inventory"
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← Inventory
        </Link>
      </div>

      {/* Status card */}
      <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="text-xs uppercase tracking-wider text-zinc-500">
          Status
        </div>
        {tokenError ? (
          <div className="mt-1 text-sm text-red-600 dark:text-red-400">
            Could not check link status: {tokenError}
          </div>
        ) : hasTokens ? (
          <div className="mt-1">
            <div className="text-sm text-emerald-600 dark:text-emerald-400">
              Linked
            </div>
            {tokenInfo && (
              <div className="mt-2 text-xs text-zinc-500 space-y-0.5">
                <div>
                  Access token expires:{" "}
                  {new Date(tokenInfo.expiresAt).toLocaleString()}
                </div>
                <div>
                  Refresh token expires:{" "}
                  {new Date(tokenInfo.refreshExpiresAt).toLocaleString()}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-1 text-sm">Not linked</div>
        )}

        {linkedFlag && (
          <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
            eBay linked successfully.
          </div>
        )}
        {ebayError && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400">
            eBay link failed: {ebayError}
            {ebayErrorDescription ? ` — ${ebayErrorDescription}` : ""}
          </div>
        )}
      </div>

      {/* Option A: OAuth */}
      <section className="mt-6">
        <h2 className="text-sm font-medium">Option A — sign in with eBay</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Standard OAuth flow. Requires a sandbox test user, and the RuName
          registered in your dev portal must have the auth-accepted URL set.
          If it doesn&apos;t work, fall back to Option B below.
        </p>
        <a
          href="/api/ebay/connect"
          className="inline-block mt-3 text-xs px-3 py-1.5 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black"
        >
          {hasTokens ? "Re-link via OAuth" : "Link eBay via OAuth"}
        </a>
      </section>

      {/* Option B: paste */}
      <section className="mt-8">
        <h2 className="text-sm font-medium">Option B — paste tokens</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Use eBay&apos;s developer-portal{" "}
          <a
            href="https://developer.ebay.com/my/auth?env=sandbox&index=0"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            User Token Tool
          </a>{" "}
          to generate an access token + refresh token, then paste them here.
          We&apos;ll validate them with a test API call before saving.
        </p>
        <EbayManualTokenForm />
      </section>
    </main>
  );
}
