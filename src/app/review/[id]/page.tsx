import { notFound } from "next/navigation";
import { getListing } from "@/lib/storage";
import ReviewClient from "./review-client";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await getListing(id);
  if (!listing) notFound();
  return <ReviewClient initialListing={listing} />;
}
