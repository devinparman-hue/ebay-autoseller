"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Paste-tokens form. Posts to /api/ebay/manual-token, which validates the
 * tokens against a real eBay endpoint before saving. On success we refresh
 * the page so the status card flips to "Linked".
 *
 * Default refresh expiry of 47304000 = 18 months in seconds, which is what
 * eBay actually issues for User refresh tokens. User can override if eBay
 * gave them a different value.
 */
export default function EbayManualTokenForm() {
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
    const payload = {
      accessToken: String(fd.get("accessToken") ?? "").trim(),
      refreshToken: String(fd.get("refreshToken") ?? "").trim(),
      expiresIn: Number(fd.get("expiresIn") ?? 0),
      refreshExpiresIn: Number(fd.get("refreshExpiresIn") ?? 0) || undefined,
    };

    startTransition(async () => {
      const res = await fetch("/api/ebay/manual-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(
          body.error
            ? `${body.error}${body.detail ? ` — ${body.detail}` : ""}`
            : "Failed to save tokens."
        );
        return;
      }
      setOkMessage("Tokens saved. eBay account linked.");
      form.reset();
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3">
      <Field
        label="Access token"
        name="accessToken"
        placeholder="v^1.1#i^1#... (long string)"
        textarea
      />
      <Field
        label="Refresh token"
        name="refreshToken"
        placeholder="v^1.1#i^1#... (long string)"
        textarea
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Access token expires in (seconds)"
          name="expiresIn"
          placeholder="7200"
          type="number"
        />
        <Field
          label="Refresh expires in (seconds, optional)"
          name="refreshExpiresIn"
          placeholder="47304000"
          type="number"
          required={false}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="text-xs px-3 py-1.5 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black disabled:opacity-40"
      >
        {pending ? "Validating…" : "Save tokens"}
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

function Field({
  label,
  name,
  placeholder,
  type = "text",
  textarea = false,
  required = true,
}: {
  label: string;
  name: string;
  placeholder?: string;
  type?: string;
  textarea?: boolean;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-500">{label}</span>
      {textarea ? (
        <textarea
          name={name}
          placeholder={placeholder}
          required={required}
          rows={3}
          className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs font-mono"
        />
      ) : (
        <input
          name={name}
          type={type}
          placeholder={placeholder}
          required={required}
          className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs"
        />
      )}
    </label>
  );
}
