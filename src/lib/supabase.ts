import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client.
 *
 * Uses the service-role key, which bypasses Row Level Security. That's fine
 * because we have no user auth yet — when we add auth, we'll split this into
 * a per-request client that uses the user's access token.
 *
 * Lazy-initialized so the dev server can still boot when env vars are unset;
 * errors only surface once something actually tries to touch storage.
 */
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in .env.local — see supabase/README.md."
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/** Bucket name for listing photos. Must match the one created in schema.sql. */
export const PHOTOS_BUCKET = "listing-photos";
