-- Run this in your Supabase SQL Editor to update existing EF proposals'
-- ef_type value to match the app's rename ("Supplier Materials EF" ->
-- "Material Specific EF" - the old name implied supplier-sourced only, but
-- a material-level EF can equally come from the internal LCA team with no
-- supplier involved). Without this, existing proposals of that type stop
-- matching any EF Type dropdown option.

update ef_proposals
set ef_type = 'Material Specific EF'
where ef_type = 'Supplier Materials EF';
