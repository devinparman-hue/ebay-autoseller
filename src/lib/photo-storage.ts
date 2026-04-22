import "server-only";
import { getSupabase, PHOTOS_BUCKET } from "./supabase";

/**
 * Parse a data URL like "data:image/jpeg;base64,/9j/..." into mime + bytes.
 * Throws if the URL isn't a recognizable image data URL.
 */
function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Photo is not a base64 image data URL");
  }
  const [, mime, base64] = match;
  return { mime, buffer: Buffer.from(base64, "base64") };
}

function extFromMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  // Fallback — keep whatever's after the slash.
  return mime.split("/")[1] ?? "bin";
}

/**
 * Upload a single data URL to the photos bucket and return its public URL.
 * Path is `{listingId}/{index}.{ext}` so all a listing's photos live in one
 * virtual folder — makes cleanup on delete straightforward.
 */
export async function uploadPhoto(
  dataUrl: string,
  listingId: string,
  index: number
): Promise<string> {
  const supabase = getSupabase();
  const { mime, buffer } = parseDataUrl(dataUrl);
  const path = `${listingId}/${index}.${extFromMime(mime)}`;

  const { error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(path, buffer, {
      contentType: mime,
      upsert: true,
      cacheControl: "3600",
    });
  if (error) {
    throw new Error(`Photo upload failed (${path}): ${error.message}`);
  }

  const { data } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload all photos in parallel and return the URLs in the same order.
 * If any upload fails the whole call rejects — callers should treat this
 * as atomic failure of the listing.
 */
export async function uploadPhotos(
  dataUrls: string[],
  listingId: string
): Promise<string[]> {
  return Promise.all(dataUrls.map((d, i) => uploadPhoto(d, listingId, i)));
}

/**
 * Delete every file under the `{listingId}/` prefix. Safe to call even if
 * nothing was uploaded. Swallows "bucket empty" cases — only throws on
 * actual API errors.
 */
export async function deletePhotosForListing(listingId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: files, error: listErr } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .list(listingId);
  if (listErr) {
    throw new Error(
      `Listing photos list failed (${listingId}): ${listErr.message}`
    );
  }
  if (!files || files.length === 0) return;
  const paths = files.map((f) => `${listingId}/${f.name}`);
  const { error: rmErr } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .remove(paths);
  if (rmErr) {
    throw new Error(
      `Listing photos delete failed (${listingId}): ${rmErr.message}`
    );
  }
}
