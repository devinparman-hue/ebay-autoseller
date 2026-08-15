"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Change {
  listingId: string;
  title: string;
  outcome: "sold" | "unsold";
  salePrice?: number;
}

/**
 * Manual "check eBay for sales now" button. The daily cron does the same
 * sync automatically; this is for when you just heard the cha-ching and
 * want the inventory to reflect it immediately.
 */
export default function SyncEbayButton() {
  const router = useRouter();
  const [result, setResult] = useState<{
    message: string;
    changes: Change[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setResult(null);
    startTransition(async () => {
      const res = await fetch("/api/sync/ebay", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setResult({ message: body.error ?? "Sync failed", changes: [] });
        return;
      }
      const changes: Change[] = body.changes ?? [];
      setResult({
        message:
          changes.length === 0
            ? "Everything active is still live on eBay — no sales yet."
            : `Updated ${changes.length} listing${changes.length === 1 ? "" : "s"}.`,
        changes,
      });
      router.refresh();
    });
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="text-xs px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 disabled:opacity-40"
      >
        {pending ? "Checking eBay…" : "Sync with eBay"}
      </button>
      {result && (
        <div className="mt-2 text-xs">
          <div className="text-zinc-700 dark:text-zinc-300">
            {result.message}
          </div>
          {result.changes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-zinc-500">
              {result.changes.map((c) => (
                <li key={c.listingId}>
                  {c.title.slice(0, 40)}
                  {c.title.length > 40 ? "…" : ""} ·{" "}
                  {c.outcome === "sold"
                    ? `SOLD${c.salePrice ? ` $${c.salePrice.toFixed(2)}` : ""} 🎉`
                    : "ended without selling"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
