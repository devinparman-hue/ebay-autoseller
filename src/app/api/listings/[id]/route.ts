import { NextResponse, type NextRequest } from "next/server";
import { getListing, updateListing, deleteListing } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/listings/[id]">
) {
  const { id } = await ctx.params;
  const listing = await getListing(id);
  if (!listing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ listing });
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/listings/[id]">
) {
  const { id } = await ctx.params;
  const existing = await getListing(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let patch: Record<string, unknown>;
  try {
    patch = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowed = [
    "title",
    "description",
    "itemSpecifics",
    "condition",
    "conditionNotes",
    "suggestedPrice",
    "estimatedWeightOz",
    "estimatedDimensionsIn",
    "sizeBucket",
    "shippingService",
    "status",
    "salePrice",
    "soldAt",
    "cost",
  ] as const;

  const sanitized: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in patch) sanitized[key] = patch[key];
  }

  if ("suggestedPrice" in sanitized) {
    const newPrice = sanitized.suggestedPrice as number;
    if (newPrice !== existing.suggestedPrice) {
      sanitized.priceHistory = [
        ...existing.priceHistory,
        { price: newPrice, at: new Date().toISOString() },
      ];
    }
  }

  const next = await updateListing(id, sanitized);
  return NextResponse.json({ listing: next });
}

export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<"/api/listings/[id]">
) {
  const { id } = await ctx.params;
  const ok = await deleteListing(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
