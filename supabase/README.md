# Supabase setup

One-time setup. Takes ~5 minutes.

## 1. Create a project

1. Go to <https://supabase.com>, sign in, click **New project**.
2. Pick a name (e.g. `ebay-lister`), a strong database password, and the region
   closest to you.
3. Wait ~1 minute for provisioning.

## 2. Run the schema

1. In the project dashboard, open **SQL Editor** (left sidebar).
2. Open `supabase/schema.sql` from this repo, copy the whole file.
3. Paste into the SQL editor and click **Run**.

This creates the `listings` table and the `listing-photos` storage bucket.
Re-running is safe — every statement is idempotent.

## 3. Copy the keys into `.env.local`

In the dashboard, open **Project Settings → API**. You'll see three values:

| Supabase label           | `.env.local` var                  |
|--------------------------|-----------------------------------|
| Project URL              | `NEXT_PUBLIC_SUPABASE_URL`        |
| `anon` `public` key      | `NEXT_PUBLIC_SUPABASE_ANON_KEY`   |
| `service_role` key (⚠️)  | `SUPABASE_SERVICE_ROLE_KEY`       |

The service-role key bypasses Row Level Security — **never commit it, never
expose it to the browser**. Only the `NEXT_PUBLIC_…` vars end up in client
bundles; the service-role key stays server-only.

## 4. Restart the dev server

```
npx next dev
```

That's it. New listings write to Postgres; photos write to the
`listing-photos` bucket.

## Troubleshooting

- **"Supabase not configured"** — env vars missing or misspelled. Check
  `.env.local` and restart the dev server.
- **"new row violates row-level security policy"** — you're using the anon
  key on the server instead of the service-role key. Double-check which key
  is in `SUPABASE_SERVICE_ROLE_KEY`.
- **Photos 404** — the `listing-photos` bucket isn't public. Re-run
  `schema.sql`, or in the dashboard: **Storage → listing-photos → Settings
  → Public bucket → on**.
