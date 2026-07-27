"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Step 2 of the paste-the-URL OAuth flow: user pastes the full URL from
 * eBay's "Authorization successfully completed" page; we exchange the
 * embedded code for an access + refresh token pair server-side.
 */
export default function EbayCodeForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOkMessage(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const redirectUrl = String(fd.get("redirectUrl") ?? "").trim();

    startTransition(async () => {
      const res = await fetch("/api/ebay/manual-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirectUrl }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(
          body.error
            ? `${body.error}${body.detail ? ` — ${body.detail}` : ""}`
            : "Failed to link."
        );
        return;
      }
      setOkMessage(
        body.hasRefreshToken
          ? "Linked with a refresh token — the app will renew access automatically from now on."
          : "Linked (access token only)."
      );
      form.reset();
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3">
      <label className="block">
        <span className="text-xs text-zinc-500">
          Paste the full URL from the &quot;Authorization successfully
          completed&quot; page
        </span>
        <textarea
          name="redirectUrl"
          required
          rows={3}
          placeholder="https://auth2.ebay.com/oauth2/ThirdPartyAuthSucessFailure?isAuthSuccessful=true&code=v%5E1.1..."
          className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs font-mono"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="text-xs px-3 py-1.5 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black disabled:opacity-40"
      >
        {pending ? "Exchanging…" : "Complete link"}
      </button>
      {error && (
        <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
      )}
      {okMessage && (
        <div className="text-xs text-emerald-600 dark:text-emerald-400">
          {okMessage}
        </div>
      )}
    </form>
  );
}
