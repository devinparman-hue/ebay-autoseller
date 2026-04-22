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
