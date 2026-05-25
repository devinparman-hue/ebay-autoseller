import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";

/**
 * eBay Marketplace Account Deletion / Closure notification endpoint.
 *
 * eBay requires every PRODUCTION application to have one of these before it
 * will enable the production keyset. When an eBay user deletes their eBay
 * account, eBay POSTs a notification here so apps can purge that user's
 * personal data (GDPR/CCPA compliance).
 *
 * This app is single-seller: we store our own OAuth token and our own
 * listing data — not other eBay users' personal data. So there's nothing
 * to purge on a deletion notice; we just acknowledge with 200. But we still
 * must implement eBay's verification handshake to get the endpoint enabled.
 *
 * Handshake (GET): eBay sends ?challenge_code=XXX. We must respond 200 with
 *   { "challengeResponse": sha256(challengeCode + verificationToken + endpointUrl) }
 * where verificationToken is a shared secret we also enter in the eBay
 * portal, and endpointUrl is the exact URL configured there.
 *
 * Notification (POST): eBay sends a JSON body describing the deletion. We
 * log it and return 200.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared secret between eBay and this endpoint. Must MATCH the verification
// token entered in the eBay dev portal. 32–80 chars, [A-Za-z0-9_-]. Override
// via env if you want to rotate it without a code change.
const VERIFICATION_TOKEN =
  process.env.EBAY_VERIFICATION_TOKEN ??
  "tlh_ebay_acctdel_9f3a7c21b8d40566af1e2c3d4b5a6978";

// Must EXACTLY match the endpoint URL entered in the eBay dev portal,
// because it's part of the challenge hash. Override via env if the domain
// changes (custom domain, preview deploy, etc.).
const ENDPOINT_URL =
  process.env.EBAY_DELETION_ENDPOINT ??
  "https://ebay-autoseller.vercel.app/api/ebay/deletion-notification";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const challengeCode = url.searchParams.get("challenge_code");
  if (!challengeCode) {
    return NextResponse.json(
      { error: "missing challenge_code" },
      { status: 400 }
    );
  }
  // Order matters: challengeCode + verificationToken + endpoint.
  const challengeResponse = createHash("sha256")
    .update(challengeCode)
    .update(VERIFICATION_TOKEN)
    .update(ENDPOINT_URL)
    .digest("hex");

  return NextResponse.json({ challengeResponse }, { status: 200 });
}

export async function POST(req: NextRequest) {
  // We don't persist other eBay users' personal data, so there's nothing to
  // delete — just record the notice and acknowledge.
  try {
    const body = await req.json().catch(() => null);
    console.log(
      "eBay marketplace account deletion notification:",
      JSON.stringify(body)
    );
  } catch {
    // ignore malformed bodies; we still must 200 so eBay doesn't retry forever
  }
  return new NextResponse(null, { status: 200 });
}
