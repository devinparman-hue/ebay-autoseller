import "server-only";
import { getEbayConfig, getValidAccessToken } from "./ebay";
import type { ConditionGrade, Listing } from "./types";

/**
 * High-level eBay Sell API client.
 *
 * Posting a listing on eBay is a three-call ritual:
 *   1. PUT /sell/inventory/v1/inventory_item/{sku}   — the product data
 *   2. POST /sell/inventory/v1/offer                  — links it to a marketplace
 *      (needs: price, category, business policies, inventory location)
 *   3. POST /sell/inventory/v1/offer/{offerId}/publish — makes it live
 *
 * Anything you'd configure in Seller Hub (policies, locations, etc.) is a
 * prerequisite. We assume the user has business policies set up; if not we
 * surface a specific error pointing at the seller hub. The inventory
 * location we auto-create on first use because it's cheap and bot-friendly.
 *
 * Category: we ask eBay's taxonomy API for a suggestion based on the title.
 * If that fails we fall back to category 99 ("Everything Else > Other") so
 * sandbox testing isn't blocked by classification.
 *
 * Locale + marketplace are hardcoded to US for now; if we go international
 * we'll plumb them through.
 */

const DEFAULT_LOCATION_KEY = "default";
// BCP-47 tag for the Content-Language / Accept-Language HTTP headers.
// MUST be hyphenated ("en-US"): the underscore form ("en_US") is only for
// the Inventory API's `locale` JSON field, and sending it as a header makes
// some Sell endpoints fail with an opaque 500 + empty errors[] (observed on
// createPaymentPolicy) while others happen to tolerate it.
const HEADER_LANGUAGE = "en-US";
const DEFAULT_MARKETPLACE = "EBAY_US";
const DEFAULT_CURRENCY = "USD";
/**
 * Seed for the catch-all fallback: eBay's "Everything Else" ROOT category.
 * Not itself publishable (it's a parent, not a leaf — publishing into it
 * fails with errorId 25005); ensureLeafCategory() descends from it to its
 * "Other" leaf child.
 */
const FALLBACK_CATEGORY_ID = "99";

/**
 * Map our internal condition grades to eBay's Inventory API enums.
 *
 * Trap: the graded enums (USED_GOOD=5000, USED_ACCEPTABLE=6000, and
 * LIKE_NEW=2750) are only valid in categories with graded conditions
 * (books/movies/music). Everything else — including all the household
 * stuff this app lists — only accepts the generic "Used" condition (3000),
 * whose API enum is confusingly named USED_EXCELLENT. Publishing with a
 * graded enum in a normal category fails with errorId 25021 ("condition id
 * is invalid for the selected primary category"). The nuance we lose here
 * is carried in conditionDescription instead, which is how most sellers
 * express it anyway.
 */
const CONDITION_MAP: Record<ConditionGrade, string> = {
  new: "NEW", // 1000
  like_new: "NEW_OTHER", // 1500 "New other (see details)" — 2750 LIKE_NEW is media-only
  used_good: "USED_EXCELLENT", // 3000 — the universal "Used"
  used_acceptable: "USED_EXCELLENT", // 3000; nuance lives in conditionDescription
  for_parts: "FOR_PARTS_OR_NOT_WORKING", // 7000
};

/* ----------------------------- HTTP wrapper ----------------------------- */

/**
 * Thin wrapper around fetch that:
 *  - pulls a fresh access token via getValidAccessToken (handles refresh)
 *  - prefixes with the configured apiHost
 *  - sets the headers eBay wants
 *  - turns non-2xx into a typed EbayError carrying eBay's own error JSON
 */
async function ebayFetch<T = unknown>(
  path: string,
  init: RequestInit & { skipBody?: boolean } = {}
): Promise<T> {
  const cfg = getEbayConfig();
  const token = await getValidAccessToken();
  const { skipBody, ...rest } = init;
  const res = await fetch(`${cfg.apiHost}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Language": HEADER_LANGUAGE,
      "Accept-Language": HEADER_LANGUAGE,
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: unknown;
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
    // Include the HTTP method + eBay's request id in the path so an empty
    // error body still tells us which call (GET list vs POST create) broke
    // and gives something to grep eBay logs with.
    const method = (rest.method ?? "GET").toUpperCase();
    const reqId = res.headers.get("x-ebay-c-request-id") ?? "";
    throw new EbayApiError(
      res.status,
      body,
      `${method} ${path}${reqId ? ` [${reqId}]` : ""}`
    );
  }
  if (skipBody || res.status === 204) {
    return undefined as unknown as T;
  }
  // Some PUTs return empty bodies on success.
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export class EbayApiError extends Error {
  status: number;
  body: unknown;
  path: string;
  constructor(status: number, body: unknown, path: string) {
    const summary =
      typeof body === "string"
        ? body.slice(0, 200)
        : JSON.stringify(body).slice(0, 400);
    super(`eBay ${status} ${path}: ${summary}`);
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

/* ------------------------------- Policies ------------------------------- */

interface PolicyListResponse {
  total?: number;
  fulfillmentPolicies?: Array<{ fulfillmentPolicyId: string; name: string }>;
  paymentPolicies?: Array<{ paymentPolicyId: string; name: string }>;
  returnPolicies?: Array<{ returnPolicyId: string; name: string }>;
}

export interface PolicyIds {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
}

/**
 * Get the IDs of one of each kind of business policy, creating sensible
 * defaults if any are missing. Sandbox seller hub is flaky and routinely
 * bounces to /n/error when you try to create policies via the UI; doing
 * it via API sidesteps all of that.
 *
 * If the user already has policies (e.g., they configured them manually
 * in seller hub or via an earlier post), we use the first of each. Only
 * the missing ones get created.
 */
export async function getPolicies(): Promise<PolicyIds> {
  // eBay rejects policy creation/use with errorId 20403 ("User is not
  // eligible for Business Policy") until the account opts into the
  // SELLING_POLICY_MANAGEMENT program. Do that first, then create.
  await ensureBusinessPolicyOptIn();
  // Sequential (not Promise.all) so behavior is deterministic: each policy
  // fully resolves before the next starts, and an in-flight retry on one
  // isn't abandoned when another rejects. Retry each on 5xx — the
  // list-then-create pattern makes retries safe (a policy created despite a
  // 500 is found on the next list and reused, not duplicated).
  const fulfillmentPolicyId = await withRetry(() => ensureFulfillmentPolicy());
  const paymentPolicyId = await withRetry(() => ensurePaymentPolicy());
  const returnPolicyId = await withRetry(() => ensureReturnPolicy());
  return { fulfillmentPolicyId, paymentPolicyId, returnPolicyId };
}

/**
 * Retry a function on eBay 5xx responses (transient sandbox flakiness /
 * propagation lag). Does NOT retry 4xx — those are our bugs, not eBay's.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  tries = 3,
  delayMs = 3000
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retriable = err instanceof EbayApiError && err.status >= 500;
      if (retriable && attempt < tries - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

interface OptedInProgramsResponse {
  programs?: Array<{ programType: string }>;
}

/**
 * Opt the account into the Business Policy program if it isn't already.
 * Required before any business policy can be created or attached to an
 * offer. Idempotent — we check the current opt-ins first so re-running a
 * post doesn't error on a redundant opt-in.
 */
async function ensureBusinessPolicyOptIn(): Promise<void> {
  const res = await ebayFetch<OptedInProgramsResponse>(
    "/sell/account/v1/program/get_opted_in_programs"
  );
  const optedIn = res.programs?.some(
    (p) => p.programType === "SELLING_POLICY_MANAGEMENT"
  );
  if (optedIn) return;

  await ebayFetch("/sell/account/v1/program/opt_in", {
    method: "POST",
    body: JSON.stringify({ programType: "SELLING_POLICY_MANAGEMENT" }),
    skipBody: true,
  });
}

const POLICY_QUERY = `marketplace_id=${DEFAULT_MARKETPLACE}`;
const DEFAULT_CATEGORY_TYPES = [
  { name: "ALL_EXCLUDING_MOTORS_VEHICLES" as const },
];

async function ensureFulfillmentPolicy(): Promise<string> {
  const list = await ebayFetch<PolicyListResponse>(
    `/sell/account/v1/fulfillment_policy?${POLICY_QUERY}`
  );
  const existing = list.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;
  if (existing) return existing;

  // No fulfillment policy on file — make a sensible default: flat-rate $5,
  // 3-day handling, US only, using eBay's GENERIC "standard shipping"
  // service code. Generic codes (ShippingMethodStandard) aren't tied to a
  // carrier, so they sidestep the "is this specific USPS code in sandbox's
  // list" problem that rejected USPSGroundAdvantage and USPSPriorityMail.
  // The user can pick a real carrier service later via seller hub.
  const created = await ebayFetch<{ fulfillmentPolicyId: string }>(
    "/sell/account/v1/fulfillment_policy",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Default Fulfillment",
        description: "Auto-created by ebay-lister",
        marketplaceId: DEFAULT_MARKETPLACE,
        categoryTypes: DEFAULT_CATEGORY_TYPES,
        handlingTime: { value: 3, unit: "DAY" },
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                sortOrder: 1,
                shippingServiceCode: "ShippingMethodStandard",
                freeShipping: false,
                shippingCost: { value: "5.00", currency: DEFAULT_CURRENCY },
                buyerResponsibleForShipping: false,
                buyerResponsibleForPickup: false,
              },
            ],
          },
        ],
      }),
    }
  );
  return created.fulfillmentPolicyId;
}

async function ensurePaymentPolicy(): Promise<string> {
  const list = await ebayFetch<PolicyListResponse>(
    `/sell/account/v1/payment_policy?${POLICY_QUERY}`
  );
  const existing = list.paymentPolicies?.[0]?.paymentPolicyId;
  if (existing) return existing;

  // Managed Payments accounts don't list payment methods explicitly;
  // eBay handles it. Minimal body — production has rejected fuller bodies
  // (with description, immediatePay) with a useless 500 + empty errors[],
  // so we send only the three required fields. Add fields back only if a
  // specific error tells us to.
  const created = await ebayFetch<{ paymentPolicyId: string }>(
    "/sell/account/v1/payment_policy",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Default Payment",
        marketplaceId: DEFAULT_MARKETPLACE,
        categoryTypes: DEFAULT_CATEGORY_TYPES,
      }),
    }
  );
  return created.paymentPolicyId;
}

async function ensureReturnPolicy(): Promise<string> {
  const list = await ebayFetch<PolicyListResponse>(
    `/sell/account/v1/return_policy?${POLICY_QUERY}`
  );
  const existing = list.returnPolicies?.[0]?.returnPolicyId;
  if (existing) return existing;

  // 30-day buyer-paid returns. Reasonable middle ground for a household
  // reseller — protects buyers without making returns the seller's
  // problem to ship back.
  const created = await ebayFetch<{ returnPolicyId: string }>(
    "/sell/account/v1/return_policy",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Default Return",
        description: "Auto-created by ebay-lister",
        marketplaceId: DEFAULT_MARKETPLACE,
        categoryTypes: DEFAULT_CATEGORY_TYPES,
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        returnShippingCostPayer: "BUYER",
        returnMethod: "MONEY_BACK",
      }),
    }
  );
  return created.returnPolicyId;
}

/* ------------------------ Listing defaults (edit) ----------------------- */

/**
 * In-app editing of the shared shipping/return policies. Exists because
 * eBay's own business-policy web UI persistently errors for this account
 * ("Sorry, something went wrong" / Akamai failures) while the Account API
 * works fine — so the app is the only reliable way to change these.
 *
 * Edits apply to every listing the app posts AND to live listings that
 * reference the policies (eBay propagates policy changes).
 */

interface FulfillmentPolicyDetail {
  fulfillmentPolicyId: string;
  name: string;
  handlingTime?: { value: number; unit: string };
  shippingOptions?: Array<{
    optionType: string;
    costType: string;
    shippingServices?: Array<{
      shippingServiceCode?: string;
      freeShipping?: boolean;
      shippingCost?: { value: string; currency: string };
    }>;
  }>;
}

interface ReturnPolicyDetail {
  returnPolicyId: string;
  name: string;
  returnsAccepted?: boolean;
  returnPeriod?: { value: number; unit: string };
}

export interface ListingDefaults {
  fulfillmentPolicyId: string;
  fulfillmentPolicyName: string;
  returnPolicyId: string;
  returnPolicyName: string;
  shippingCostUsd: number;
  freeShipping: boolean;
  shippingServiceCode: string;
  handlingTimeDays: number;
  returnsAccepted: boolean;
  returnPeriodDays: number;
}

/** Read the current shared policies as a flat editable settings object. */
export async function getListingDefaults(): Promise<ListingDefaults> {
  const [f, r] = await Promise.all([
    ebayFetch<{ fulfillmentPolicies?: FulfillmentPolicyDetail[] }>(
      `/sell/account/v1/fulfillment_policy?${POLICY_QUERY}`
    ),
    ebayFetch<{ returnPolicies?: ReturnPolicyDetail[] }>(
      `/sell/account/v1/return_policy?${POLICY_QUERY}`
    ),
  ]);
  const fp = f.fulfillmentPolicies?.[0];
  const rp = r.returnPolicies?.[0];
  if (!fp || !rp) {
    throw new Error(
      "No policies on the account yet — they're created on your first post. " +
        "Post one listing, then edit defaults here."
    );
  }
  const svc = fp.shippingOptions?.[0]?.shippingServices?.[0];
  return {
    fulfillmentPolicyId: fp.fulfillmentPolicyId,
    fulfillmentPolicyName: fp.name,
    returnPolicyId: rp.returnPolicyId,
    returnPolicyName: rp.name,
    shippingCostUsd: svc?.shippingCost ? Number(svc.shippingCost.value) : 0,
    freeShipping: svc?.freeShipping ?? false,
    shippingServiceCode: svc?.shippingServiceCode ?? "ShippingMethodStandard",
    handlingTimeDays: fp.handlingTime?.value ?? 3,
    returnsAccepted: rp.returnsAccepted ?? true,
    returnPeriodDays: rp.returnPeriod?.value ?? 30,
  };
}

export interface ListingDefaultsUpdate {
  shippingCostUsd: number;
  freeShipping: boolean;
  handlingTimeDays: number;
  returnsAccepted: boolean;
  returnPeriodDays: number;
}

/**
 * Rewrite both policies with the given settings. We rebuild the bodies
 * from scratch (same shapes we create them with) rather than round-tripping
 * eBay's response object — avoids echoing read-only fields back at a PUT
 * endpoint that might reject them.
 */
export async function updateListingDefaults(
  input: ListingDefaultsUpdate
): Promise<void> {
  const current = await getListingDefaults();

  const shippingService: Record<string, unknown> = {
    sortOrder: 1,
    shippingServiceCode: current.shippingServiceCode,
    freeShipping: input.freeShipping,
    buyerResponsibleForShipping: false,
    buyerResponsibleForPickup: false,
  };
  if (!input.freeShipping) {
    shippingService.shippingCost = {
      value: input.shippingCostUsd.toFixed(2),
      currency: DEFAULT_CURRENCY,
    };
  }
  await ebayFetch(
    `/sell/account/v1/fulfillment_policy/${current.fulfillmentPolicyId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        name: current.fulfillmentPolicyName,
        marketplaceId: DEFAULT_MARKETPLACE,
        categoryTypes: DEFAULT_CATEGORY_TYPES,
        handlingTime: { value: input.handlingTimeDays, unit: "DAY" },
        // The update endpoint is stricter than create: it 400s with
        // "Global shipping field is null" (etc.) if these aren't sent
        // explicitly, even though create happily defaults them all.
        globalShipping: false,
        pickupDropOff: false,
        freightShipping: false,
        localPickup: false,
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [shippingService],
          },
        ],
      }),
      skipBody: true,
    }
  );

  const returnBody: Record<string, unknown> = {
    name: current.returnPolicyName,
    marketplaceId: DEFAULT_MARKETPLACE,
    categoryTypes: DEFAULT_CATEGORY_TYPES,
    returnsAccepted: input.returnsAccepted,
  };
  if (input.returnsAccepted) {
    returnBody.returnPeriod = { value: input.returnPeriodDays, unit: "DAY" };
    returnBody.returnShippingCostPayer = "BUYER";
    returnBody.returnMethod = "MONEY_BACK";
  }
  await ebayFetch(`/sell/account/v1/return_policy/${current.returnPolicyId}`, {
    method: "PUT",
    body: JSON.stringify(returnBody),
    skipBody: true,
  });
}

/* -------------------------- Inventory location -------------------------- */

interface LocationResponse {
  merchantLocationKey: string;
  name?: string;
}

interface SellerAddress {
  addressLine1: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
}

/**
 * Resolve the ship-from address for the inventory location. This is shown
 * to buyers and drives shipping-cost zones, so it must be real in
 * production. We read it from SELLER_* env vars.
 *
 * In production we REFUSE to fall back to placeholders — better to fail the
 * post with a clear "set your address" error than to publish a real listing
 * shipping from a fake California address. In sandbox the placeholders are
 * fine (nobody's actually buying).
 */
function getSellerAddress(): SellerAddress {
  const cfg = getEbayConfig();
  const line1 = process.env.SELLER_ADDRESS_LINE1;
  const city = process.env.SELLER_CITY;
  const state = process.env.SELLER_STATE;
  const postalCode = process.env.SELLER_POSTAL_CODE;
  const country = process.env.SELLER_COUNTRY || "US";

  if (cfg.env === "production") {
    const missing: string[] = [];
    if (!line1) missing.push("SELLER_ADDRESS_LINE1");
    if (!city) missing.push("SELLER_CITY");
    if (!state) missing.push("SELLER_STATE");
    if (!postalCode) missing.push("SELLER_POSTAL_CODE");
    if (missing.length > 0) {
      throw new Error(
        `Production listings need a real ship-from address. Set ${missing.join(
          ", "
        )} in your Vercel env vars (your real address — city/state/ZIP are ` +
          `shown to buyers and set shipping zones).`
      );
    }
  }

  return {
    addressLine1: line1 || "123 Test Street",
    city: city || "San Jose",
    stateOrProvince: state || "CA",
    postalCode: postalCode || "95125",
    country,
  };
}

/**
 * Make sure we have an inventory location to attach offers to. Required
 * by eBay even for digital-only sellers. We use a single fixed key and
 * auto-create it the first time using the SELLER_* address (see
 * getSellerAddress). The user can edit it later via Seller Hub.
 */
export async function ensureInventoryLocation(): Promise<string> {
  try {
    await ebayFetch<LocationResponse>(
      `/sell/inventory/v1/location/${DEFAULT_LOCATION_KEY}`
    );
    return DEFAULT_LOCATION_KEY;
  } catch (err) {
    if (!(err instanceof EbayApiError) || err.status !== 404) {
      throw err;
    }
    // Doesn't exist — create it with the configured ship-from address.
    const address = getSellerAddress();
    await ebayFetch(
      `/sell/inventory/v1/location/${DEFAULT_LOCATION_KEY}`,
      {
        method: "POST",
        body: JSON.stringify({
          location: { address },
          locationInstructions: "Auto-created by ebay-lister",
          name: "Default Location",
          merchantLocationStatus: "ENABLED",
          locationTypes: ["WAREHOUSE"],
        }),
        skipBody: true,
      }
    );
    return DEFAULT_LOCATION_KEY;
  }
}

/* ------------------------------- Taxonomy ------------------------------- */

interface DefaultTreeResponse {
  categoryTreeId: string;
}

interface CategorySuggestionsResponse {
  categorySuggestions?: Array<{
    category: { categoryId: string; categoryName: string };
  }>;
}

interface SubtreeNode {
  category: { categoryId: string; categoryName: string };
  leafCategoryTreeNode?: boolean;
  childCategoryTreeNodes?: SubtreeNode[];
}

interface SubtreeResponse {
  categorySubtreeNode?: SubtreeNode;
}

/** The default category tree never changes for a marketplace — cache it. */
let cachedTreeId: string | null = null;
async function getCategoryTreeId(): Promise<string> {
  if (cachedTreeId) return cachedTreeId;
  const tree = await ebayFetch<DefaultTreeResponse>(
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${DEFAULT_MARKETPLACE}`
  );
  cachedTreeId = tree.categoryTreeId;
  return cachedTreeId;
}

/**
 * eBay only allows publishing into LEAF categories (errorId 25005
 * otherwise) — and neither category suggestions nor our fallback are
 * guaranteed to be leaves. Verify via the subtree endpoint, and when the
 * node has children, walk down to the shallowest leaf, preferring a child
 * named "Other" (eBay's catch-all convention) at each level.
 */
async function ensureLeafCategory(
  treeId: string,
  categoryId: string
): Promise<string> {
  const res = await ebayFetch<SubtreeResponse>(
    `/commerce/taxonomy/v1/category_tree/${treeId}` +
      `/get_category_subtree?category_id=${encodeURIComponent(categoryId)}`
  );
  const root = res.categorySubtreeNode;
  if (!root) return categoryId;
  const queue: SubtreeNode[] = [root];
  let steps = 0;
  while (queue.length > 0 && steps++ < 500) {
    const node = queue.shift()!;
    const kids = node.childCategoryTreeNodes ?? [];
    if (node.leafCategoryTreeNode === true || kids.length === 0) {
      return node.category.categoryId;
    }
    kids.sort(
      (a, b) =>
        Number(b.category.categoryName === "Other") -
        Number(a.category.categoryName === "Other")
    );
    queue.push(...kids);
  }
  return categoryId;
}

/**
 * Ask eBay what category best fits a given title, guaranteeing a leaf.
 * If the full title matches nothing, retry with a shortened query (AI
 * titles are long and spec-heavy, which can stump the matcher); if that
 * fails too, descend from "Everything Else" to its catch-all leaf. Throws
 * only when the taxonomy API itself is unreachable — publishing without a
 * valid leaf would fail anyway, so a clear message beats a cryptic 25005.
 */
export async function getSuggestedCategoryId(title: string): Promise<string> {
  let treeId: string;
  try {
    treeId = await getCategoryTreeId();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Couldn't reach eBay's category service to classify this item — try again. (${message})`
    );
  }

  // Suggestion lookups 404 when nothing matches; treat that as "no answer".
  const suggest = async (q: string): Promise<string | undefined> => {
    try {
      const s = await ebayFetch<CategorySuggestionsResponse>(
        `/commerce/taxonomy/v1/category_tree/${treeId}` +
          `/get_category_suggestions?q=${encodeURIComponent(q)}`
      );
      return s.categorySuggestions?.[0]?.category?.categoryId;
    } catch {
      return undefined;
    }
  };

  let candidate = await suggest(title);
  if (!candidate) {
    const short = title.split(/\s+/).slice(0, 4).join(" ");
    if (short && short !== title) candidate = await suggest(short);
  }
  candidate ??= FALLBACK_CATEGORY_ID;

  try {
    return await ensureLeafCategory(treeId, candidate);
  } catch {
    // Subtree lookup hiccuped — best effort with the raw candidate.
    return candidate;
  }
}

/* ----------------------- Inventory item + offer ------------------------- */

/** Upsert an inventory item keyed by SKU (we use listing.id). */
export async function putInventoryItem(
  sku: string,
  listing: Listing
): Promise<void> {
  // eBay aspects are arrays of strings per key. Our itemSpecifics are
  // single strings — wrap each into a one-element array.
  const aspects: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(listing.itemSpecifics ?? {})) {
    if (typeof v === "string" && v.length > 0) {
      aspects[k] = [v];
    }
  }

  await ebayFetch(`/sell/inventory/v1/inventory_item/${sku}`, {
    method: "PUT",
    body: JSON.stringify({
      product: {
        title: listing.title.slice(0, 80), // eBay max title length
        description: listing.description,
        imageUrls: listing.photos,
        aspects,
      },
      condition: CONDITION_MAP[listing.condition],
      conditionDescription:
        listing.conditionNotes?.slice(0, 1000) || undefined,
      availability: {
        shipToLocationAvailability: { quantity: 1 },
      },
      packageWeightAndSize: {
        weight: {
          value: Number((listing.estimatedWeightOz / 16).toFixed(2)),
          unit: "POUND",
        },
        dimensions: {
          length: listing.estimatedDimensionsIn.l,
          width: listing.estimatedDimensionsIn.w,
          height: listing.estimatedDimensionsIn.h,
          unit: "INCH",
        },
      },
    }),
    skipBody: true,
  });
}

interface CreateOfferResponse {
  offerId: string;
}

interface OfferListResponse {
  offers?: Array<{ offerId: string }>;
  total?: number;
}

/**
 * Create the offer for a SKU — or, if one already exists (a previous post
 * attempt that failed at publish leaves an unpublished offer behind),
 * update it in place with the current fields. Makes the whole post flow
 * safely retryable: price/category/description edits between attempts are
 * carried onto the existing offer instead of erroring with "offer entity
 * already exists".
 */
export async function ensureOffer(args: {
  sku: string;
  categoryId: string;
  description: string;
  price: number;
  policies: PolicyIds;
  locationKey: string;
}): Promise<string> {
  const offerBody = {
    sku: args.sku,
    marketplaceId: DEFAULT_MARKETPLACE,
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: args.categoryId,
    listingDescription: args.description,
    listingPolicies: {
      fulfillmentPolicyId: args.policies.fulfillmentPolicyId,
      paymentPolicyId: args.policies.paymentPolicyId,
      returnPolicyId: args.policies.returnPolicyId,
    },
    merchantLocationKey: args.locationKey,
    pricingSummary: {
      price: {
        value: args.price.toFixed(2),
        currency: DEFAULT_CURRENCY,
      },
    },
  };

  // getOffers 404s when the SKU has no offers — treat that as "none".
  const existing = await ebayFetch<OfferListResponse>(
    `/sell/inventory/v1/offer?sku=${encodeURIComponent(args.sku)}` +
      `&marketplace_id=${DEFAULT_MARKETPLACE}`
  ).catch((err) => {
    if (err instanceof EbayApiError && err.status === 404) {
      return {} as OfferListResponse;
    }
    throw err;
  });

  const existingId = existing.offers?.[0]?.offerId;
  if (existingId) {
    await ebayFetch(`/sell/inventory/v1/offer/${existingId}`, {
      method: "PUT",
      body: JSON.stringify(offerBody),
      skipBody: true,
    });
    return existingId;
  }

  const created = await ebayFetch<CreateOfferResponse>(
    "/sell/inventory/v1/offer",
    { method: "POST", body: JSON.stringify(offerBody) }
  );
  return created.offerId;
}

interface PublishOfferResponse {
  listingId: string;
}

export async function publishOffer(offerId: string): Promise<string> {
  const result = await ebayFetch<PublishOfferResponse>(
    `/sell/inventory/v1/offer/${offerId}/publish`,
    { method: "POST" }
  );
  return result.listingId;
}

/* ----------------------- High-level orchestrator ------------------------ */

export interface PostResult {
  /** eBay's listing ID — what appears in URLs and the seller hub. */
  ebayListingId: string;
  /** Internal offer ID (kept in case we want to revise/end later). */
  offerId: string;
  /** SKU we used (= our listing.id). */
  sku: string;
  postedAt: string;
}

/**
 * Take a draft Listing and publish it to eBay. Runs all four prerequisite
 * steps in sequence and surfaces any failure with as much context as
 * possible. The caller is expected to mark the Listing as `active` and
 * store the returned `ebayListingId` only after this resolves successfully.
 */
export async function postToEbay(listing: Listing): Promise<PostResult> {
  if (!listing.photos || listing.photos.length === 0) {
    throw new Error("Listing has no photos; eBay requires at least one.");
  }

  // These two can run in parallel — they're independent.
  const [policies, locationKey] = await Promise.all([
    getPolicies(),
    ensureInventoryLocation(),
  ]);

  const categoryId = await getSuggestedCategoryId(listing.title);

  const sku = listing.id;
  await putInventoryItem(sku, listing);
  const offerId = await ensureOffer({
    sku,
    categoryId,
    description: listing.description,
    price: listing.suggestedPrice,
    policies,
    locationKey,
  });
  const ebayListingId = await publishOffer(offerId);

  return {
    ebayListingId,
    offerId,
    sku,
    postedAt: new Date().toISOString(),
  };
}
