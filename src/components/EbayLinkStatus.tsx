import { isEbayLinked } from "@/lib/ebay";

/**
 * Inline widget shown at the top of /inventory.
 *
 * Two responsibilities:
 *   1. Show whether we have valid eBay tokens on file. If not, show a
 *      "Link eBay" button that kicks off the OAuth flow via /api/ebay/connect.
 *   2. Render a banner reflecting the latest OAuth callback outcome
 *      (?linked=1 or ?ebay_error=…), so the user gets feedback after
 *      completing (or failing) the flow.
 *
 * Server component — `isEbayLinked()` reads from Supabase, so we keep it on
 * the server to avoid exposing the service-role key.
 */
export default async function EbayLinkStatus({
  linked,
  error,
  errorDescription,
}: {
  linked: boolean;
  error?: string;
  errorDescription?: string;
}) {
  const hasTokens = await isEbayLinked();

  return (
    <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs">
          <div className="uppercase tracking-wider text-zinc-500">
            eBay account
          </div>
          <div
            className={
              "mt-0.5 text-sm " +
              (hasTokens
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-zinc-900 dark:text-zinc-100")
            }
          >
            {hasTokens ? "Linked" : "Not linked"}
          </div>
        </div>
        <a
          href="/api/ebay/connect"
          className="text-xs px-3 py-1.5 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black"
        >
          {hasTokens ? "Re-link" : "Link eBay"}
        </a>
      </div>

      {linked && (
        <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
          eBay linked successfully.
        </div>
      )}
      {error && (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400">
          eBay link failed: {error}
          {errorDescription ? ` — ${errorDescription}` : ""}
        </div>
      )}
    </div>
  );
}
