import { NextResponse } from "next/server";
import { listListings } from "@/lib/storage";
import { getOffersForSku, EbayApiError } from "@/lib/ebay-sell";

/**
 * Diagnostic: for every non-draft listing the app knows about, show what
 * eBay's offer lookup returns — status, listingStatus, soldQuantity. Used
 * to debug "eBay says it sold but the app still shows Active": tells us
 * whether the app even has the listing, whether the offer exists on eBay,
 * and what sold count eBay reports.
 *
 * TODO: remove once sold-sync is verified working.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  let listings;
  try {
    listings = await listListings();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "db_failed", detail: message.slice(0, 300) },
      { status: 500 }
    );
  }

  const relevant = listings.filter((l) => l.status !== "draft");
  const results = [];
  for (const l of relevant) {
    let ebay: unknown;
    try {
      ebay = await getOffersForSku(l.id);
    } catch (err) {
      ebay =
        err instanceof EbayApiError
          ? { error: err.status, detail: err.body }
          : { error: err instanceof Error ? err.message.slice(0, 200) : "?" };
    }
    results.push({
      title: l.title.slice(0, 60),
      localStatus: l.status,
      sku: l.id,
      ebayListingId: l.ebayListingId ?? null,
      ebay,
    });
  }

  return NextResponse.json({
    note:
      "localStatus = what the app thinks; ebay.offers[].listing.soldQuantity " +
      "= what eBay reports. A listing sold on eBay but Active here should " +
      "show soldQuantity >= 1.",
    count: results.length,
    results,
  });
}
