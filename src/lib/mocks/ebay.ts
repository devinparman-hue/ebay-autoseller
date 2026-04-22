import "server-only";
import type { Listing } from "../types";

export interface MockPostResult {
  ebayListingId: string;
  fbListingId: string;
  postedAt: string;
}

export async function mockPostToMarketplaces(
  listing: Listing
): Promise<MockPostResult> {
  await new Promise((r) => setTimeout(r, 400));
  const now = new Date().toISOString();
  return {
    ebayListingId: `MOCK-EBAY-${listing.id.slice(0, 8)}`,
    fbListingId: `MOCK-FB-${listing.id.slice(0, 8)}`,
    postedAt: now,
  };
}
