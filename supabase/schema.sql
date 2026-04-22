-- ebay-lister schema
-- Paste this into your Supabase project's SQL editor and hit "Run".
-- Safe to re-run: every statement is idempotent.

-- ───────────────────────────── listings table ───────────────────────────────
create table if not exists public.listings (
  id                        uuid primary key,
  status                    text not null check (status in ('draft','active','sold','unsold')),
  title                     text not null default '',
  description               text not null default '',
  item_specifics            jsonb not null default '{}'::jsonb,
  condition                 text not null default 'used_good',
  condition_notes           text not null default '',
  suggested_price           numeric(10,2) not null default 0,
  estimated_weight_oz       numeric(10,2) not null default 0,
  estimated_dimensions_in   jsonb not null default '{"l":0,"w":0,"h":0}'::jsonb,
  size_bucket               text not null default 'lt1lb',
  shipping_service          text not null default '',
  confidence                text not null default 'medium',
  flags                     jsonb not null default '[]'::jsonb,
  photos                    jsonb not null default '[]'::jsonb,
  posted_at                 timestamptz,
  sold_at                   timestamptz,
  sale_price                numeric(10,2),
  ebay_listing_id           text,
  fb_listing_id             text,
  cost                      numeric(10,2),
  price_history             jsonb not null default '[]'::jsonb,
  created_at                timestamptz not null default now()
);

create index if not exists listings_status_idx     on public.listings (status);
create index if not exists listings_created_at_idx on public.listings (created_at desc);

-- RLS is on by default for new tables; we bypass it with the service-role key
-- on the server. If you later add per-user auth, add proper policies here.
alter table public.listings enable row level security;

-- ──────────────────────────── photos bucket ─────────────────────────────────
-- Public bucket so <img src=…> works without signed URLs. Change to private
-- later when you wire up auth + signed URLs.
insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

-- ──────────────────────────── ebay_tokens table ─────────────────────────────
-- Stores the OAuth access + refresh tokens we get back from eBay after the
-- user clicks "Link eBay" and completes the consent flow. One row per env
-- (sandbox/production) — we're single-tenant for now, so we don't key by user.
--
-- access_token: short-lived (~2 hours), used as the Bearer for Sell API calls.
-- refresh_token: long-lived (~18 months), used to mint a new access_token.
-- expires_at / refresh_expires_at: absolute times, easier to reason about than
-- the `expires_in` seconds eBay actually returns.
-- scopes: space-delimited list of OAuth scopes granted, echoed back from eBay.
create table if not exists public.ebay_tokens (
  id                   uuid primary key default gen_random_uuid(),
  env                  text not null check (env in ('sandbox','production')),
  access_token         text not null,
  refresh_token        text not null,
  expires_at           timestamptz not null,
  refresh_expires_at   timestamptz not null,
  scopes               text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Unique per env so upsert-by-env works for the Link flow and future re-links.
create unique index if not exists ebay_tokens_env_idx on public.ebay_tokens (env);

alter table public.ebay_tokens enable row level security;
