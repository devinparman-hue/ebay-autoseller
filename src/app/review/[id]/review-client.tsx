"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CONDITION_LABELS,
  SIZE_BUCKET_LABELS,
  type ConditionGrade,
  type Listing,
  type SizeBucket,
} from "@/lib/types";

const CONDITIONS = Object.keys(CONDITION_LABELS) as ConditionGrade[];
const SIZE_BUCKETS = Object.keys(SIZE_BUCKET_LABELS) as SizeBucket[];

export default function ReviewClient({
  initialListing,
}: {
  initialListing: Listing;
}) {
  const router = useRouter();
  const [listing, setListing] = useState<Listing>(initialListing);
  const [editing, setEditing] = useState<
    null | "title" | "description" | "price" | "condition" | "shipping"
  >(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Partial<Listing>) {
    setError(null);
    const res = await fetch(`/api/listings/${listing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const { error: err } = await res.json().catch(() => ({ error: null }));
      setError(err ?? `Save failed (${res.status})`);
      return;
    }
    const { listing: next } = await res.json();
    setListing(next);
    setEditing(null);
  }

  function post() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/listings/${listing.id}/post`, {
        method: "POST",
      });
      if (!res.ok) {
        const { error: err } = await res.json().catch(() => ({ error: null }));
        setError(err ?? `Post failed (${res.status})`);
        return;
      }
      router.push("/inventory");
    });
  }

  function del() {
    if (!confirm("Delete this draft?")) return;
    startTransition(async () => {
      const res = await fetch(`/api/listings/${listing.id}`, {
        method: "DELETE",
      });
      if (res.ok) router.push("/capture");
    });
  }

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 pt-6 pb-28">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Review draft</h1>
        <span
          className={`text-xs px-2 py-1 rounded-full ${
            listing.confidence === "high"
              ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200"
              : listing.confidence === "medium"
                ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                : "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          AI confidence: {listing.confidence}
        </span>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto -mx-4 px-4 snap-x snap-mandatory">
        {listing.photos.map((src, i) => (
          <div
            key={i}
            className="shrink-0 w-40 h-40 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-900 snap-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`photo ${i + 1}`}
              className="w-full h-full object-cover"
            />
          </div>
        ))}
      </div>

      {listing.flags.length > 0 && (
        <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-sm">
          <div className="font-medium mb-1">Flags to review:</div>
          <ul className="list-disc ml-5 space-y-0.5">
            {listing.flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 space-y-4">
        <Field
          label="Title"
          editing={editing === "title"}
          onEdit={() => setEditing("title")}
          onCancel={() => setEditing(null)}
        >
          {editing === "title" ? (
            <EditTitle
              initial={listing.title}
              onSave={(title) => save({ title })}
            />
          ) : (
            <p className="text-base">{listing.title}</p>
          )}
        </Field>

        <Field
          label="Description"
          editing={editing === "description"}
          onEdit={() => setEditing("description")}
          onCancel={() => setEditing(null)}
        >
          {editing === "description" ? (
            <EditDescription
              initial={listing.description}
              onSave={(description) => save({ description })}
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{listing.description}</p>
          )}
        </Field>

        <Field
          label="Price"
          editing={editing === "price"}
          onEdit={() => setEditing("price")}
          onCancel={() => setEditing(null)}
        >
          {editing === "price" ? (
            <EditPrice
              initial={listing.suggestedPrice}
              onSave={(suggestedPrice) => save({ suggestedPrice })}
            />
          ) : (
            <p className="text-xl font-semibold">
              ${listing.suggestedPrice.toFixed(2)}
            </p>
          )}
        </Field>

        <Field
          label="Condition"
          editing={editing === "condition"}
          onEdit={() => setEditing("condition")}
          onCancel={() => setEditing(null)}
        >
          {editing === "condition" ? (
            <EditCondition
              initial={listing.condition}
              initialNotes={listing.conditionNotes}
              onSave={(condition, conditionNotes) =>
                save({ condition, conditionNotes })
              }
            />
          ) : (
            <div>
              <p className="text-base">{CONDITION_LABELS[listing.condition]}</p>
              {listing.conditionNotes && (
                <p className="text-sm text-zinc-500 mt-1">
                  {listing.conditionNotes}
                </p>
              )}
            </div>
          )}
        </Field>

        <Field
          label="Shipping"
          editing={editing === "shipping"}
          onEdit={() => setEditing("shipping")}
          onCancel={() => setEditing(null)}
        >
          {editing === "shipping" ? (
            <EditShipping
              initialBucket={listing.sizeBucket}
              initialService={listing.shippingService}
              onSave={(sizeBucket, shippingService) =>
                save({ sizeBucket, shippingService })
              }
            />
          ) : (
            <div className="text-sm">
              <p>{SIZE_BUCKET_LABELS[listing.sizeBucket]}</p>
              <p className="text-zinc-500">
                via {listing.shippingService} · est.{" "}
                {listing.estimatedWeightOz.toFixed(0)} oz
              </p>
            </div>
          )}
        </Field>

        {Object.keys(listing.itemSpecifics).length > 0 && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Item specifics
            </div>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              {Object.entries(listing.itemSpecifics).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-900 text-sm dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="mt-8 space-y-3">
        <button
          type="button"
          onClick={post}
          disabled={pending || listing.status !== "draft"}
          className="w-full h-14 rounded-2xl bg-zinc-950 text-white font-medium disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {listing.status !== "draft"
            ? `Already ${listing.status}`
            : pending
              ? "Posting…"
              : "✓ Approve & post to eBay + Facebook"}
        </button>
        <button
          type="button"
          onClick={del}
          disabled={pending}
          className="w-full h-12 rounded-2xl text-red-600 dark:text-red-400 font-medium"
        >
          Delete draft
        </button>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
  editing,
  onEdit,
  onCancel,
}: {
  label: string;
  children: React.ReactNode;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        <button
          type="button"
          onClick={editing ? onCancel : onEdit}
          className="text-xs text-zinc-600 dark:text-zinc-300 underline underline-offset-2"
        >
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>
      {children}
    </div>
  );
}

function EditTitle({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div>
      <input
        className="w-full bg-transparent border-b border-zinc-300 dark:border-zinc-700 py-2 outline-none focus:border-zinc-950 dark:focus:border-white"
        value={v}
        maxLength={80}
        onChange={(e) => setV(e.target.value)}
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-zinc-500">{v.length}/80</span>
        <button
          type="button"
          onClick={() => onSave(v)}
          className="text-sm px-3 py-1 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function EditDescription({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div>
      <textarea
        className="w-full bg-transparent border border-zinc-300 dark:border-zinc-700 rounded p-2 min-h-32 outline-none focus:border-zinc-950 dark:focus:border-white"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <div className="flex justify-end mt-2">
        <button
          type="button"
          onClick={() => onSave(v)}
          className="text-sm px-3 py-1 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function EditPrice({
  initial,
  onSave,
}: {
  initial: number;
  onSave: (v: number) => void;
}) {
  const [v, setV] = useState(String(initial));
  return (
    <div className="flex items-center gap-2">
      <span className="text-xl">$</span>
      <input
        type="number"
        step="0.01"
        min="0"
        className="flex-1 bg-transparent border-b border-zinc-300 dark:border-zinc-700 py-2 outline-none focus:border-zinc-950 dark:focus:border-white text-xl"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0) onSave(n);
        }}
        className="text-sm px-3 py-1 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black"
      >
        Save
      </button>
    </div>
  );
}

function EditCondition({
  initial,
  initialNotes,
  onSave,
}: {
  initial: ConditionGrade;
  initialNotes: string;
  onSave: (c: ConditionGrade, notes: string) => void;
}) {
  const [c, setC] = useState<ConditionGrade>(initial);
  const [notes, setNotes] = useState(initialNotes);
  return (
    <div className="space-y-2">
      <select
        value={c}
        onChange={(e) => setC(e.target.value as ConditionGrade)}
        className="w-full bg-transparent border border-zinc-300 dark:border-zinc-700 rounded p-2"
      >
        {CONDITIONS.map((x) => (
          <option key={x} value={x}>
            {CONDITION_LABELS[x]}
          </option>
        ))}
      </select>
      <textarea
        placeholder="Condition notes (flaws, wear, etc.)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full bg-transparent border border-zinc-300 dark:border-zinc-700 rounded p-2 min-h-20"
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSave(c, notes)}
          className="text-sm px-3 py-1 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function EditShipping({
  initialBucket,
  initialService,
  onSave,
}: {
  initialBucket: SizeBucket;
  initialService: string;
  onSave: (b: SizeBucket, s: string) => void;
}) {
  const [bucket, setBucket] = useState<SizeBucket>(initialBucket);
  const [service, setService] = useState(initialService);
  return (
    <div className="space-y-2">
      <select
        value={bucket}
        onChange={(e) => setBucket(e.target.value as SizeBucket)}
        className="w-full bg-transparent border border-zinc-300 dark:border-zinc-700 rounded p-2"
      >
        {SIZE_BUCKETS.map((x) => (
          <option key={x} value={x}>
            {SIZE_BUCKET_LABELS[x]}
          </option>
        ))}
      </select>
      <input
        value={service}
        onChange={(e) => setService(e.target.value)}
        className="w-full bg-transparent border border-zinc-300 dark:border-zinc-700 rounded p-2"
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSave(bucket, service)}
          className="text-sm px-3 py-1 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-black"
        >
          Save
        </button>
      </div>
    </div>
  );
}
