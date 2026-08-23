-- Run this in your Supabase SQL Editor to pick up round-3 changes WITHOUT
-- wiping any existing data. (schema.sql itself was also updated to include
-- these for fresh installs.)

-- 1. "Mark as Ingested" timestamp flag on ef_proposals (E4).
alter table ef_proposals add column if not exists ingested_at timestamptz;

-- 2. Evidence file storage bucket - replaces the old free-text evidence
--    link field. Public bucket so uploaded files can be viewed via a plain
--    public URL; RLS policy left wide open to match every other table in
--    this demo (synthetic data only, no real auth).
insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', true)
on conflict (id) do nothing;

create policy "public demo - full access" on storage.objects
  for all to public
  using (bucket_id = 'evidence')
  with check (bucket_id = 'evidence');
