import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { analyzePhotos } from "@/lib/vision";
import { saveListing } from "@/lib/storage";
import { uploadPhotos } from "@/lib/photo-storage";
import type { Listing } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface AnalyzeBody {
  photos: string[];
}

export async function POST(request: Request) {
  let body: AnalyzeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.photos) || body.photos.length === 0) {
    return NextResponse.json(
      { error: "At least one photo is required" },
      { status: 400 }
    );
  }

  if (body.photos.length > 8) {
    return NextResponse.json(
      { error: "Max 8 photos per listing" },
      { status: 400 }
    );
  }

  const id = randomUUID();

  try {
    // Vision call and photo upload are independent — run them in parallel.
    // Vision takes ~several seconds; uploads should be near-instant.
    const [draft, photoUrls] = await Promise.all([
      analyzePhotos(body.photos),
      uploadPhotos(body.photos, id),
    ]);
    const now = new Date().toISOString();
    const listing: Listing = {
      id,
      status: "draft",
      photos: photoUrls,
      createdAt: now,
      priceHistory: [{ price: draft.suggestedPrice, at: now }],
      ...draft,
    };
    await saveListing(listing);
    return NextResponse.json({ listing });
  } catch (err) {
    console.error("analyze failed", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Vision analysis failed: ${message}` },
      { status: 500 }
    );
  }
}
