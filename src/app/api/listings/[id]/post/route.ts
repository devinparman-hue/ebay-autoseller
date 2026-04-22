import { NextResponse, type NextRequest } from "next/server";
import { getListing, updateListing } from "@/lib/storage";
import { mockPostToMarketplaces } from "@/lib/mocks/ebay";

export const runtime = "nodejs";

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

  const result = await mockPostToMarketplaces(listing);
  const next = await updateListing(id, {
    status: "active",
    postedAt: result.postedAt,
    ebayListingId: result.ebayListingId,
    fbListingId: result.fbListingId,
  });

  return NextResponse.json({ listing: next });
}
