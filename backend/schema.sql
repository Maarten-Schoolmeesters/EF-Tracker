-- EF Tracker - Supabase schema
-- Paste this whole file into: Supabase project -> SQL Editor -> New query -> Run
-- Safe to re-run: drops and recreates everything below.

-- ============================================================
-- CLEANUP (safe re-run)
-- ============================================================
drop view if exists product_mapping cascade;
drop table if exists notifications cascade;
drop table if exists audit_log cascade;
drop table if exists ef_proposal_versions cascade;
drop table if exists ef_proposals cascade;
drop table if exists eeio_ef cascade;
drop table if exists eeio cascade;
drop table if exists global_factors_inventory cascade;
drop table if exists common_id cascade;
drop table if exists supplier_ccf_index cascade;
drop table if exists material_specific_factors cascade;
drop table if exists product_mapping_raw cascade;
drop table if exists carbon_app_export cascade;
drop table if exists ef_sources_methods_assurance cascade;
drop table if exists users cascade;

-- ============================================================
-- REFERENCE DATA TABLES
-- (all replaceable independently later - see README "Replacing data")
-- ============================================================

create table users (
  user_id text primary key,
  name text not null,
  roles text[] not null default '{}',        -- subset of the 5 role values below
  open_ef_reviews int not null default 0,
  open_ef_approvals int not null default 0
);
comment on column users.roles is 'Values: Expert EF Reviewer, Standard EF Reviewer, EF Approver, Project Owner, Project Reviewer';

create table ef_sources_methods_assurance (
  id serial primary key,
  category text not null,          -- EF Source | EF Methodology | EF Assurance
  option_no int not null,
  option_label text not null,
  includes_text text not null,
  review_route text                -- null for Source/Methodology rows; 'Expert Reviewer' / 'Standard Reviewer' for Assurance rows
);

create table carbon_app_export (
  id serial primary key,
  ghg_category text,
  source_system text,
  data_source text,
  company_code text,
  indicator_name text,
  business_division text,
  year int,
  site_country text,
  site_name text,
  parent_supplier_name text,
  supplier_name text,
  supplier_number text,
  supplier_address text,
  supplier_city text,
  supplier_country text,
  category_level_1_enriched text,
  category_level_2_enriched text,
  category_level_3_enriched text,
  category_level_4_enriched text,
  co2_factor numeric,
  co2_factor_final numeric,
  co2_factor_name_final text,
  co2_factor_name_supplier_submissions text,
  gplt text,
  gplt1 text,
  gplt2 text,
  material text,
  material_code text,
  co2e_mt numeric,
  tonnage numeric,
  uom text,
  quantity_corrected numeric,
  invoice_quantity numeric
);
create index on carbon_app_export (material_code);
create index on carbon_app_export (supplier_number);

create table material_specific_factors (
  id serial primary key,
  material_code text,
  material_description text,
  supplier_name text,
  supplier_id text,
  emission_factor_name text,
  ef_kgco2e_per_unit numeric,
  units_per_kg numeric,
  weight_per_unit_kg numeric
);
create index on material_specific_factors (material_code);

create table supplier_ccf_index (
  id serial primary key,
  supplier_name text,
  emission_factor_name text,
  parent_supplier_mapping_initial text,
  supplier_number text,
  ef_per_1000_gbp numeric
);
create index on supplier_ccf_index (supplier_number);

create table common_id (
  id serial primary key,
  material_id text,
  material_description text,
  common_id1 text,
  primary_material_weight_g numeric,
  comment text,
  invoice_paid_date date,
  year int
);
create index on common_id (material_id);
create index on common_id (common_id1);

create table global_factors_inventory (
  id serial primary key,
  common_id1 text,
  emission_factor_name_historic text,
  co2_emission_factor_current numeric
);
create index on global_factors_inventory (common_id1);

create table eeio (
  id serial primary key,
  ghg_scope3_category text,
  enriched_l1l2l3_classification text,
  category_level_1_enriched text,
  category_level_2_enriched text,
  category_level_3_enriched text,
  year int
);
create index on eeio (category_level_1_enriched, category_level_2_enriched, category_level_3_enriched);
create index on eeio (enriched_l1l2l3_classification);

create table eeio_ef (
  id serial primary key,
  enriched_l1l2l3_classification text,
  emission_factor_name text,
  eeio_factor_kgco2e_gbp numeric,
  year int
);
create index on eeio_ef (enriched_l1l2l3_classification);

create table product_mapping_raw (
  id serial primary key,
  year_of_exercise int,
  product_name text,
  product_brand text,
  material_id_code text,
  material_description text,
  business_division text,
  site text
);
create index on product_mapping_raw (material_id_code);

-- Derived table per PPT slide 8: unique material_id_code -> latest year_of_exercise -> product_name of that year
create view product_mapping as
select distinct on (material_id_code)
  material_id_code,
  year_of_exercise,
  product_name
from product_mapping_raw
where material_id_code is not null
order by material_id_code, year_of_exercise desc nulls last;

-- ============================================================
-- TRANSACTIONAL DATA (EF pages only for now - Project pages out of scope per current requirements)
-- ============================================================

create table ef_proposals (
  change_id text primary key,          -- e.g. EF-2026-0001, generated by app
  ef_type text not null,               -- 'Supplier Materials EF' | 'Supplier Spend EF / CFF index' | 'Global EF' | 'CEDA EF'
  status text not null default 'E1-Draft',  -- E1-Draft | E2-Review | E3-Approval | E4-Ready | E5-OnHold | E6-Cancelled
  frozen boolean not null default false,
  project_id text,                     -- always null for now (Project pages deferred)
  proposer_id text references users(user_id),
  reviewer_id text references users(user_id),
  approver_id text references users(user_id),
  on_hold_from_status text,            -- remembers which stage to return to after On Hold
  fields jsonb not null default '{}',       -- type-specific input fields (material codes, GPLT, common id, eeio class, new EF value, unit, mass...)
  common_fields jsonb not null default '{}',-- source/methodology/assurance/evidence (storage path+filename)/comment
  derived jsonb not null default '{}',      -- computed: new_ef_name, review_route, % change, impact, product brand...
  review_steps jsonb not null default '[]', -- checklist state for E2
  approval_notes text,
  ingested_at timestamptz,             -- set when marked as ingested into the Carbon App at E4; same field a future real integration would set automatically
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger ef_proposals_set_updated_at
  before update on ef_proposals
  for each row execute function set_updated_at();

create table ef_proposal_versions (
  id serial primary key,
  change_id text references ef_proposals(change_id) on delete cascade,
  version_no int not null,
  stage text not null,
  action_label text,                   -- e.g. 'Create draft', 'Submit for review', 'Return for revision'
  snapshot jsonb not null,             -- full copy of ef_proposals row at time of transition
  changed_by text references users(user_id),
  changed_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  user_id text references users(user_id),
  action text not null,
  object_type text not null,
  object_id text,
  old_value jsonb,
  new_value jsonb,
  at timestamptz not null default now()
);

create table notifications (
  id bigserial primary key,
  user_id text references users(user_id),
  message text not null,
  related_change_id text references ef_proposals(change_id),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Demo tool, synthetic data only, no real auth -> open read/write via anon key.
-- DO NOT reuse this policy set for a tool holding real confidential data.
-- ============================================================
alter table users enable row level security;
alter table ef_sources_methods_assurance enable row level security;
alter table carbon_app_export enable row level security;
alter table material_specific_factors enable row level security;
alter table supplier_ccf_index enable row level security;
alter table common_id enable row level security;
alter table global_factors_inventory enable row level security;
alter table eeio enable row level security;
alter table eeio_ef enable row level security;
alter table product_mapping_raw enable row level security;
alter table ef_proposals enable row level security;
alter table ef_proposal_versions enable row level security;
alter table audit_log enable row level security;
alter table notifications enable row level security;

create policy "public demo - full access" on users for all using (true) with check (true);
create policy "public demo - full access" on ef_sources_methods_assurance for all using (true) with check (true);
create policy "public demo - full access" on carbon_app_export for all using (true) with check (true);
create policy "public demo - full access" on material_specific_factors for all using (true) with check (true);
create policy "public demo - full access" on supplier_ccf_index for all using (true) with check (true);
create policy "public demo - full access" on common_id for all using (true) with check (true);
create policy "public demo - full access" on global_factors_inventory for all using (true) with check (true);
create policy "public demo - full access" on eeio for all using (true) with check (true);
create policy "public demo - full access" on eeio_ef for all using (true) with check (true);
create policy "public demo - full access" on product_mapping_raw for all using (true) with check (true);
create policy "public demo - full access" on ef_proposals for all using (true) with check (true);
create policy "public demo - full access" on ef_proposal_versions for all using (true) with check (true);
create policy "public demo - full access" on audit_log for all using (true) with check (true);
create policy "public demo - full access" on notifications for all using (true) with check (true);

-- ============================================================
-- STORAGE (evidence file uploads for EF proposals)
-- Small demo-purpose files only (screenshot / short PDF) - well within
-- Supabase's free-tier storage limits. Public bucket so uploaded files can
-- be viewed via a plain public URL without a signed-URL round trip.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', true)
on conflict (id) do nothing;

create policy "public demo - full access" on storage.objects
  for all to public
  using (bucket_id = 'evidence')
  with check (bucket_id = 'evidence');
