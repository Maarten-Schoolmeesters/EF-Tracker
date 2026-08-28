-- Round 6: E4-Ready -> E4-Ingestion (simulated SNOW ticket sub-stages) and
-- E5-OnHold -> E5-Blocked (mandatory reason/comment + auto-assigned EF Data
-- Steward). Run this whole file in your Supabase SQL Editor against the live
-- project - schema.sql alone won't reach an already-populated database.

-- ---- users: new workload counter for EF Data Steward auto-assignment ----
alter table users add column if not exists open_ef_blocked_items int not null default 0;

-- ---- ef_proposals: column rename + new columns ----
alter table ef_proposals rename column on_hold_from_status to blocked_from_status;
alter table ef_proposals add column if not exists data_steward_id text references users(user_id);
alter table ef_proposals add column if not exists blocked_reason text;
alter table ef_proposals add column if not exists blocked_comment text;
alter table ef_proposals add column if not exists snow_ticket_id text;
alter table ef_proposals add column if not exists snow_ticket_status text;
alter table ef_proposals add column if not exists snow_ticket_raised_at timestamptz;

-- ---- rename the stage codes themselves on every existing row ----
update ef_proposals set status = 'E4-Ingestion' where status = 'E4-Ready';
update ef_proposals set status = 'E5-Blocked' where status = 'E5-OnHold';
update ef_proposals set blocked_from_status = 'E4-Ingestion' where blocked_from_status = 'E4-Ready';
update ef_proposal_versions set stage = 'E4-Ingestion' where stage = 'E4-Ready';
update ef_proposal_versions set stage = 'E5-Blocked' where stage = 'E5-OnHold';
-- Note: older version snapshots (the jsonb `snapshot` column) still read
-- "E4-Ready"/"E5-OnHold" inside their own JSON where that was genuinely the
-- stage name at the time - left as-is, since that's an accurate historical
-- record, not a bug. Only the current `status`/`stage` columns are renamed.

-- ---- invented EF Data Steward users, so auto-assignment has someone to pick ----
insert into users (user_id, name, roles, open_ef_reviews, open_ef_approvals, open_ef_blocked_items)
values
  ('U-2001', 'Ravi Sorensen', '{"EF Data Steward"}', 0, 0, 0),
  ('U-2002', 'Hannah Kowalski', '{"EF Data Steward"}', 0, 0, 0),
  ('U-2003', 'Tariq Duarte', '{"EF Data Steward"}', 0, 0, 0)
on conflict (user_id) do nothing;
