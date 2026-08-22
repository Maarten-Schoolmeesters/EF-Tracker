# EF Tracker (first workshop mock-up)

A first architecture mock-up of the EF Tracker tool described in the requirements deck, built for free design-workshop demos.

**No real company data is used anywhere in this repo.** The Excel files anonymized by the company's own tooling still leaked real relationships and lost the relationships needed for the demo (see git history / conversation), so all reference data here is entirely invented (fictional pharma-style materials, suppliers, products) - see `data-generation/generate_data.py`.

## Architecture

- **Frontend**: static HTML/CSS/vanilla JS (`app/`), no build step. Hosted free on GitHub Pages.
- **Backend**: [Supabase](https://supabase.com) free tier - Postgres database + auto-generated REST API, called directly from the browser via the Supabase JS client.
- No real authentication - a "Logged in as" switcher in the sidebar simulates different users/roles for the workshop. Row Level Security is wide open (`backend/schema.sql`) since this holds only synthetic demo data. **Do not reuse this RLS setup for a tool holding real confidential data.**

## One-time setup

1. **Create a free Supabase project**: go to [supabase.com](https://supabase.com), sign up, "New project" (pick any name/region, free plan).
2. **Run the schema**: open your project's SQL Editor, paste the entire contents of `backend/schema.sql`, click Run. This creates all tables, the derived `product_mapping` view, and RLS policies.
3. **Import the demo data**: for each CSV in `backend/csv/`, go to Table Editor -> the matching table -> Insert -> Import data from CSV, and import it (table names match file names exactly).
4. **Get your API credentials**: Project Settings -> API -> copy the "Project URL" and the "anon public" key.
5. **Configure the frontend**: edit `app/js/config.js` and paste in those two values.
6. **Run locally** to test: from `app/`, run a static server, e.g. `py -m http.server 8000` (ES modules need to be served over http, not opened as a `file://` path), then open `http://localhost:8000`.
7. **Deploy for free**: push this repo to GitHub, enable GitHub Pages (Settings -> Pages -> deploy from branch, folder `/app`), share the resulting URL.

## Replacing the reference data later

Each reference table is independent CSV -> Supabase table. To replace one:
- Edit/regenerate the source (either hand-edit a CSV, or edit `data-generation/generate_data.py` and rerun `py generate_data.py`), then in Supabase Table Editor: truncate the table (or delete all rows) and re-import the new CSV.
- No code changes needed as long as column names stay the same.

## Known scope limitations (see conversation for full list of requirement gaps flagged)

- Project Entry / Project Log pages are out of scope for this mock-up (EF pages only, per instruction).
- E2/E3/E4 detail fields and the review checklist are placeholders - the deck itself marks these "TBD w/ LCA team". A sensible sustainability-review checklist was implemented in the meantime.
- Notifications are in-app only (stored in the `notifications` table), not real emails.
- `common_id` and `product_mapping_raw` were generated at a smaller row count than the original anonymized files for practical CSV-import size (see comments in `generate_data.py`); relational structure is unaffected and the generator constant can be raised any time.
