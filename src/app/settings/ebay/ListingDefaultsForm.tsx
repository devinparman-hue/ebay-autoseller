"use client";

import { useEffect, useState, useTransition } from "react";

/**
 * Editor for the shared listing defaults (flat shipping cost, free
 * shipping, handling time, returns). Loads current values from eBay via
 * /api/ebay/policy-settings on mount; saving PUTs them back. Changes apply
 * to future posts and to live listings referencing the policies.
 */

interface Defaults {
  shippingCostUsd: number;
  freeShipping: boolean;
  shippingServiceCode: string;
  handlingTimeDays: number;
  returnsAccepted: boolean;
  returnPeriodDays: number;
}

export default function ListingDefaultsForm() {
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ebay/policy-settings");
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(
            body.error
              ? `${body.error}${body.detail ? ` — ${JSON.stringify(body.detail).slice(0, 300)}` : ""}`
              : `Failed to load (${res.status})`
          );
          return;
        }
        setDefaults(body.defaults);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function save() {
    if (!defaults) return;
    setSaveError(null);
    setOkMessage(null);
    startTransition(async () => {
      const res = await fetch("/api/ebay/policy-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defaults),
      });
      const body = await res.json();
      if (!res.ok) {
        setSaveError(
          body.error
            ? `${body.error}${body.detail ? ` — ${JSON.stringify(body.detail).slice(0, 300)}` : ""}`
            : "Save failed."
        );
        return;
      }
      setDefaults(body.defaults);
      setOkMessage("Saved. Applies to new posts and live listings.");
    });
  }

  if (loadError) {
    return (
      <div className="mt-3 text-xs text-red-600 dark:text-red-400 break-words">
        Couldn&apos;t load current settings: {loadError}
      </div>
    );
  }
  if (!defaults) {
    return (
      <div className="mt-3 text-xs text-zinc-500">Loading from eBay…</div>
    );
  }

  const set = (patch: Partial<Defaults>) =>
    setDefaults((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="mt-3 space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={defaults.freeShipping}
          onChange={(e) => set({ freeShipping: e.target.checked })}
        />
        Free shipping (bake shipping into the item price)
      </label>

      {!defaults.freeShipping && (
        <label className="block">
          <span className="text-xs text-zinc-500">
            Flat shipping charge (USD, buyer pays)
          </span>
          <input
            type="number"
            min={0}
            step="0.50"
            value={defaults.shippingCostUsd}
            onChange={(e) => set({ shippingCostUsd: Number(e.target.value) })}
            className="mt-1 w-32 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-sm"
          />
        </label>
      )}

      <label className="block">
        <span className="text-xs text-zinc-500">
          Handling time (business days until you ship)
        </span>
        <select
          value={defaults.handlingTimeDays}
          onChange={(e) => set({ handlingTimeDays: Number(e.target.value) })}
          className="mt-1 block w-40 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-sm"
        >
          {[1, 2, 3, 5, 10].map((d) => (
            <option key={d} value={d}>
              {d} day{d === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={defaults.returnsAccepted}
          onChange={(e) => set({ returnsAccepted: e.target.checked })}
        />
        Accept returns
      </label>

      {defaults.returnsAccepted && (
        <label className="block">
          <span className="text-xs text-zinc-500">
            Return window (buyer pays return shipping)
          </span>
          <select
            value={defaults.returnPeriodDays}
            onChange={(e) => set({ returnPeriodDays: Number(e.target.value) })}
            className="mt-1 block w-40 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-sm"
          >
            {[14, 30, 60].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="text-xs px-3 py-1.5 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save defaults"}
      </button>

      {saveError && (
        <div className="text-xs text-red-600 dark:text-red-400 break-words">
          {saveError}
        </div>
      )}
      {okMessage && (
        <div className="text-xs text-emerald-600 dark:text-emerald-400">
          {okMessage}
        </div>
      )}
    </div>
  );
}
