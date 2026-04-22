"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Change {
  listingId: string;
  title: string;
  oldPrice: number;
  newPrice: number;
  weeksElapsed: number;
}

export default function MarkdownButton() {
  const router = useRouter();
  const [result, setResult] = useState<{
    message: string;
    changes: Change[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setResult(null);
    startTransition(async () => {
      const res = await fetch("/api/cron/markdown", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setResult({ message: body.error ?? "Failed", changes: [] });
        return;
      }
      const changes: Change[] = body.changes ?? [];
      setResult({
        message:
          changes.length === 0
            ? "Nothing is 7 days old yet. Nothing to mark down."
            : `Marked down ${changes.length} listing${
                changes.length === 1 ? "" : "s"
              }.`,
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
        {pending ? "Running…" : "Run weekly markdown now"}
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
                  <span className="line-through">
                    ${c.oldPrice.toFixed(2)}
                  </span>{" "}
                  → ${c.newPrice.toFixed(2)}{" "}
                  {c.weeksElapsed > 1 && (
                    <span>({c.weeksElapsed}w catch-up)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
