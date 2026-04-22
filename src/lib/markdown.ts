import "server-only";
import { listListings, updateListing } from "./storage";
import type { Listing } from "./types";

export const WEEKLY_MARKDOWN_RATE = 0.05; // 5% per week
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const MAX_CATCHUP_WEEKS = 52; // safety cap against clock weirdness

export interface PlannedMarkdown {
  listingId: string;
  title: string;
  weeksElapsed: number;
  oldPrice: number;
  newPrice: number;
}

/**
 * Return the latest timestamp at which this listing's price changed
 * (whichever is newer: when it was posted, or the last priceHistory entry).
 * Returns null for drafts / un-posted listings.
 */
function lastPriceChangeMs(listing: Listing): number | null {
  if (!listing.postedAt) return null;
  const postedMs = new Date(listing.postedAt).getTime();
  const latestHistoryMs = listing.priceHistory.reduce(
    (max, entry) => Math.max(max, new Date(entry.at).getTime()),
    0
  );
  return Math.max(postedMs, latestHistoryMs);
}

/**
 * How many days until the next 5% markdown will fire for this listing,
 * or null if markdown doesn't apply (not active, not posted, etc.).
 *
 * Pure function — safe for server components to call on already-fetched
 * listings without hitting the DB.
 */
export function daysUntilNextMarkdown(
  listing: Listing,
  now: Date = new Date()
): number | null {
  if (listing.status !== "active") return null;
  const lastMs = lastPriceChangeMs(listing);
  if (lastMs === null) return null;
  const nextMs = lastMs + MS_PER_WEEK;
  const days = Math.ceil((nextMs - now.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, days);
}

/**
 * Compute what a markdown would do to a single listing, or null if nothing
 * should change. Pure function — used by both compute and apply so the
 * two never diverge.
 */
function planFor(listing: Listing, now: Date): PlannedMarkdown | null {
  if (listing.status !== "active") return null;
  const lastMs = lastPriceChangeMs(listing);
  if (lastMs === null) return null;

  const weeksElapsed = Math.floor((now.getTime() - lastMs) / MS_PER_WEEK);
  if (weeksElapsed < 1) return null;

  const cappedWeeks = Math.min(weeksElapsed, MAX_CATCHUP_WEEKS);
  const factor = (1 - WEEKLY_MARKDOWN_RATE) ** cappedWeeks;
  const rawNew = listing.suggestedPrice * factor;
  const newPrice = Math.round(rawNew * 100) / 100;

  if (newPrice >= listing.suggestedPrice) return null; // rounded to same value

  return {
    listingId: listing.id,
    title: listing.title,
    weeksElapsed: cappedWeeks,
    oldPrice: listing.suggestedPrice,
    newPrice,
  };
}

/**
 * Compute (but don't apply) the markdowns that would run right now.
 * Catches up: if a listing hasn't been touched in 3 weeks, applies 3 weeks
 * of compounding 5% cuts in a single adjustment.
 */
export async function computeMarkdowns(
  now: Date = new Date()
): Promise<PlannedMarkdown[]> {
  const listings = await listListings();
  const planned: PlannedMarkdown[] = [];
  for (const listing of listings) {
    const plan = planFor(listing, now);
    if (plan) planned.push(plan);
  }
  return planned;
}

export interface AppliedMarkdown extends PlannedMarkdown {
  appliedAt: string;
}

/**
 * Apply this week's markdowns. Walks the full listing list once — reusing
 * the in-memory Listing objects for the updates, so each markdown is a
 * single UPDATE query instead of a SELECT+UPDATE pair.
 */
export async function applyMarkdowns(
  now: Date = new Date()
): Promise<AppliedMarkdown[]> {
  const listings = await listListings();
  const applied: AppliedMarkdown[] = [];
  const nowIso = now.toISOString();

  for (const listing of listings) {
    const plan = planFor(listing, now);
    if (!plan) continue;

    const next = await updateListing(listing.id, {
      suggestedPrice: plan.newPrice,
      priceHistory: [
        ...listing.priceHistory,
        { price: plan.newPrice, at: nowIso },
      ],
    });
    if (next) applied.push({ ...plan, appliedAt: nowIso });
  }

  return applied;
}
