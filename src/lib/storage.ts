import "server-only";
import { getSupabase } from "./supabase";
import { deletePhotosForListing } from "./photo-storage";
import type {
  ConditionGrade,
  Listing,
  ListingStatus,
  SizeBucket,
} from "./types";

/**
 * Supabase-backed listing store. Public API mirrors the old in-memory
 * version — same function names, same return shapes — but everything is
 * async now because it talks to Postgres.
 *
 * Column naming: DB is snake_case (Postgres idiom), Listing type is
 * camelCase (TS idiom). `rowToListing` / `toRow` bridge the two.
 */

const TABLE = "listings";

/* --------------------------- row <-> Listing --------------------------- */

interface Row {
  id: string;
  status: ListingStatus;
  title: string;
  description: string;
  item_specifics: Record<string, string>;
  condition: ConditionGrade;
  condition_notes: string;
  suggested_price: number | string;
  estimated_weight_oz: number | string;
  estimated_dimensions_in: { l: number; w: number; h: number };
  size_bucket: SizeBucket;
  shipping_service: string;
  confidence: "high" | "medium" | "low";
  flags: string[];
  photos: string[];
  posted_at: string | null;
  sold_at: string | null;
  sale_price: number | string | null;
  ebay_listing_id: string | null;
  fb_listing_id: string | null;
  cost: number | string | null;
  price_history: { price: number; at: string }[];
  created_at: string;
}

/** Postgres `numeric` can come back as a string. Coerce defensively. */
function num(v: number | string): number {
  return typeof v === "string" ? Number(v) : v;
}
function numOrUndef(v: number | string | null): number | undefined {
  if (v === null) return undefined;
  return num(v);
}

function rowToListing(row: Row): Listing {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    description: row.description,
    itemSpecifics: row.item_specifics ?? {},
    condition: row.condition,
    conditionNotes: row.condition_notes,
    suggestedPrice: num(row.suggested_price),
    estimatedWeightOz: num(row.estimated_weight_oz),
    estimatedDimensionsIn: row.estimated_dimensions_in,
    sizeBucket: row.size_bucket,
    shippingService: row.shipping_service,
    confidence: row.confidence,
    flags: row.flags ?? [],
    photos: row.photos ?? [],
    createdAt: row.created_at,
    postedAt: row.posted_at ?? undefined,
    soldAt: row.sold_at ?? undefined,
    salePrice: numOrUndef(row.sale_price),
    ebayListingId: row.ebay_listing_id ?? undefined,
    fbListingId: row.fb_listing_id ?? undefined,
    cost: numOrUndef(row.cost),
    priceHistory: row.price_history ?? [],
  };
}

/** Full Listing -> row (for insert). */
function listingToRow(l: Listing): Row {
  return {
    id: l.id,
    status: l.status,
    title: l.title,
    description: l.description,
    item_specifics: l.itemSpecifics,
    condition: l.condition,
    condition_notes: l.conditionNotes,
    suggested_price: l.suggestedPrice,
    estimated_weight_oz: l.estimatedWeightOz,
    estimated_dimensions_in: l.estimatedDimensionsIn,
    size_bucket: l.sizeBucket,
    shipping_service: l.shippingService,
    confidence: l.confidence,
    flags: l.flags,
    photos: l.photos,
    posted_at: l.postedAt ?? null,
    sold_at: l.soldAt ?? null,
    sale_price: l.salePrice ?? null,
    ebay_listing_id: l.ebayListingId ?? null,
    fb_listing_id: l.fbListingId ?? null,
    cost: l.cost ?? null,
    price_history: l.priceHistory,
    created_at: l.createdAt,
  };
}

/** Translate a camelCase patch into the subset of columns to update. */
const PATCH_COLUMNS: Record<keyof Listing, string> = {
  id: "id",
  status: "status",
  title: "title",
  description: "description",
  itemSpecifics: "item_specifics",
  condition: "condition",
  conditionNotes: "condition_notes",
  suggestedPrice: "suggested_price",
  estimatedWeightOz: "estimated_weight_oz",
  estimatedDimensionsIn: "estimated_dimensions_in",
  sizeBucket: "size_bucket",
  shippingService: "shipping_service",
  confidence: "confidence",
  flags: "flags",
  photos: "photos",
  createdAt: "created_at",
  postedAt: "posted_at",
  soldAt: "sold_at",
  salePrice: "sale_price",
  ebayListingId: "ebay_listing_id",
  fbListingId: "fb_listing_id",
  cost: "cost",
  priceHistory: "price_history",
};

function patchToColumns(patch: Partial<Listing>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = PATCH_COLUMNS[k as keyof Listing];
    if (col && col !== "id" && col !== "created_at") {
      out[col] = v ?? null;
    }
  }
  return out;
}

/* ------------------------------ CRUD ---------------------------------- */

export async function listListings(): Promise<Listing[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listListings: ${error.message}`);
  return (data as Row[] | null)?.map(rowToListing) ?? [];
}

export async function getListing(id: string): Promise<Listing | undefined> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getListing(${id}): ${error.message}`);
  if (!data) return undefined;
  return rowToListing(data as Row);
}

export async function saveListing(listing: Listing): Promise<Listing> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(listingToRow(listing))
    .select("*")
    .single();
  if (error) throw new Error(`saveListing(${listing.id}): ${error.message}`);
  return rowToListing(data as Row);
}

export async function updateListing(
  id: string,
  patch: Partial<Listing>
): Promise<Listing | undefined> {
  const supabase = getSupabase();
  const cols = patchToColumns(patch);
  if (Object.keys(cols).length === 0) {
    // Nothing to update — just return current state.
    return getListing(id);
  }
  const { data, error } = await supabase
    .from(TABLE)
    .update(cols)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`updateListing(${id}): ${error.message}`);
  if (!data) return undefined;
  return rowToListing(data as Row);
}

export async function deleteListing(id: string): Promise<boolean> {
  const supabase = getSupabase();
  // Delete photos first — if that fails, we'd rather leave the row so the
  // user can retry, than orphan files in the bucket. Swallow list-errors
  // for listings whose folder was never created.
  try {
    await deletePhotosForListing(id);
  } catch (err) {
    console.warn(`deleteListing(${id}) photo cleanup failed`, err);
  }
  const { error, count } = await supabase
    .from(TABLE)
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) throw new Error(`deleteListing(${id}): ${error.message}`);
  return (count ?? 0) > 0;
}
