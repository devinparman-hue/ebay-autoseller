import { NextResponse, type NextRequest } from "next/server";
import { getListing, updateListing } from "@/lib/storage";
import { postToEbay, EbayApiError } from "@/lib/ebay-sell";

/**
 * Publish a draft listing to eBay (sandbox or production, depending on
 * EBAY_ENV). We're done with the mock now — this calls the real Sell API.
 *
 * Flow:
 *   1. Load the listing; verify it's a draft (can't re-publish a sold one)
 *   2. Call postToEbay which handles policy lookup, location, category,
 *      inventory item, offer create, and publish
 *   3. On success, mark the listing `active` and stamp the eBay listing ID
 *
 * Error surface:
 *   - 404 if the listing doesn't exist
 *   - 409 if the listing isn't in draft status
 *   - 502 if eBay returned an error (we surface eBay's body in `detail`)
 *   - 500 for anything else (token expired, network blip, etc.)
 *
 * Note: we still set `fbListingId` to a mock value — Facebook Marketplace
 * integration is a separate todo. Removing that field outright would break
 * the existing UI that shows where a listing is posted.
 */
export const runtime = "nodejs";
// Posting makes many sequential eBay calls (opt-in, policies w/ retries,
// location, category, inventory item, offer, publish). Give it headroom so
// retry delays don't trip the default function timeout. (Capped to the
// Vercel plan's max — harmless if the plan is lower.)
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/listings/[id]/post">
) {
  const { id } = await ctx.params;
  const listing = await getListing(id);
  if (!listing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (listing.status !== "draft") {
    return NextResponse.json(
      { error: `Cannot post: listing is already ${listing.status}` },
      { status: 409 }
    );
  }

  let result;
  try {
    result = await postToEbay(listing);
  } catch (err) {
    if (err instanceof EbayApiError) {
      return NextResponse.json(
        {
          error: "eBay API rejected the listing",
          status: err.status,
          path: err.path,
          detail: err.body,
        },
        { status: 502 }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }

  const next = await updateListing(id, {
    status: "active",
    postedAt: result.postedAt,
    ebayListingId: result.ebayListingId,
    // FB Marketplace not wired up yet — leave a sentinel so the UI doesn't
    // think nothing happened. Replace with real FB ID when that's built.
    fbListingId: `PENDING-FB-${listing.id.slice(0, 8)}`,
  });

  return NextResponse.json({
    listing: next,
    ebay: {
      listingId: result.ebayListingId,
      offerId: result.offerId,
      sku: result.sku,
    },
  });
}
