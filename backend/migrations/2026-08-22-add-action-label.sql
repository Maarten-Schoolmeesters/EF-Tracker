-- Run this in your Supabase SQL Editor to pick up the new "action_label"
-- column on ef_proposal_versions WITHOUT wiping any existing data.
-- (schema.sql itself was also updated to include this column for fresh installs.)

alter table ef_proposal_versions add column if not exists action_label text;
