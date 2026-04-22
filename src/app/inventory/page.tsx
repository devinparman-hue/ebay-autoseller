import Link from "next/link";
import { listListings } from "@/lib/storage";
import { daysUntilNextMarkdown } from "@/lib/markdown";
import MarkdownButton from "@/components/MarkdownButton";
import EbayLinkStatus from "@/components/EbayLinkStatus";
import type { Listing, ListingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_ORDER: ListingStatus[] = ["draft", "active", "sold", "unsold"];
const STATUS_LABELS: Record<ListingStatus, string> = {
  draft: "Drafts",
  active: "Active",
  sold: "Sold",
  unsold: "Unsold",
};

export default async function InventoryPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const firstOf = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const linked = firstOf(params.linked) === "1";
  const ebayError = firstOf(params.ebay_error);
  const ebayErrorDescription = firstOf(params.ebay_error_description);

  const listings = await listListings();
  const byStatus = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, listings.filter((l) => l.status === s)])
  ) as Record<ListingStatus, typeof listings>;

  const soldListings = byStatus.sold;
  const totalSales = soldListings.reduce(
    (acc, l) => acc + (l.salePrice ?? l.suggestedPrice),
    0
  );
  const estFees = totalSales * 0.13;
  const netEstimate = totalSales - estFees;

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 pt-6 pb-28">
      <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>

      <EbayLinkStatus
        linked={linked}
        error={ebayError}
        errorDescription={ebayErrorDescription}
      />

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Drafts" value={byStatus.draft.length} />
        <Stat label="Active" value={byStatus.active.length} />
        <Stat label="Sold" value={byStatus.sold.length} />
      </div>

      {soldListings.length > 0 && (
        <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
            All-time earnings (estimate)
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold">
              ${netEstimate.toFixed(2)}
            </span>
            <span className="text-xs text-zinc-500">
              ${totalSales.toFixed(2)} gross − ${estFees.toFixed(2)} est. fees
            </span>
          </div>
        </div>
      )}

      {byStatus.active.length > 0 && <MarkdownButton />}

      <div className="mt-6 space-y-6">
        {STATUS_ORDER.map((status) => {
          const items = byStatus[status];
          if (items.length === 0) return null;
          return (
            <section key={status}>
              <h2 className="text-sm font-medium text-zinc-500 mb-2">
                {STATUS_LABELS[status]} · {items.length}
              </h2>
              <ul className="space-y-2">
                {items.map((l) => (
                  <li key={l.id}>
                    <ListingRow listing={l} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {listings.length === 0 && (
          <div className="text-center py-12 text-sm text-zinc-500">
            <p>No listings yet.</p>
            <Link
              href="/capture"
              className="inline-block mt-2 px-4 py-2 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black"
            >
              Take your first photo
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function ListingRow({ listing }: { listing: Listing }) {
  const daysToMarkdown = daysUntilNextMarkdown(listing);
  const original = listing.priceHistory[0]?.price ?? listing.suggestedPrice;
  const markedDown = listing.suggestedPrice < original;

  return (
    <Link
      href={`/review/${listing.id}`}
      className="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
    >
      <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-900">
        {listing.photos[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.photos[0]}
            alt=""
            className="w-full h-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{listing.title}</p>
        <p className="text-xs text-zinc-500 mt-0.5">
          {markedDown && (
            <span className="line-through mr-1">${original.toFixed(2)}</span>
          )}
          <span className={markedDown ? "text-zinc-900 dark:text-zinc-100" : ""}>
            ${listing.suggestedPrice.toFixed(2)}
          </span>{" "}
          · {new Date(listing.createdAt).toLocaleDateString()}
        </p>
        {daysToMarkdown !== null && (
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
            Next 5% markdown{" "}
            {daysToMarkdown === 0
              ? "ready now"
              : daysToMarkdown === 1
                ? "in 1 day"
                : `in ${daysToMarkdown} days`}
          </p>
        )}
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="text-xs text-zinc-500 uppercase tracking-wider">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-0.5">{value}</div>
    </div>
  );
}
