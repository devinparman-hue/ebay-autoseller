import { NextResponse } from "next/server";
import { listListings } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ listings: await listListings() });
}
