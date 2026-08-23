"""
Synthetic pharma-flavoured reference data generator for EF Tracker.

Generates fully relational demo data (no real company data, no anonymization
tokens) matching the table/column structure described in the requirements
deck. Output: one CSV per reference table in ../backend/csv/, ready to import
via Supabase Table Editor -> Insert -> Import data from CSV.

To regenerate or resize: edit the SIZE constants below and rerun:
    py generate_data.py
"""
import csv
import os
import random

random.seed(42)

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "backend", "csv")
os.makedirs(OUT_DIR, exist_ok=True)

# ------------------------------------------------------------------
# SIZE CONSTANTS (order-of-magnitude match to the originally supplied
# anonymized files; the two largest were scaled down for practical
# CSV-import size while keeping the same relational richness - see README)
# ------------------------------------------------------------------
N_MATERIALS = 150            # material master (source: ~ same order as CAE materials)
N_SUPPLIERS = 40
N_CAE_ROWS = 80               # Carbon App Export (orig sample: 70)
N_MSF_COVERAGE = 0.6          # fraction of materials that get a Material Specific Factor
N_CCF_HISTORIC_PER_SUPPLIER = 7   # -> ~280 rows (orig: 1517, scaled down)
N_COMMON_ID_BUCKETS = 55
N_COMMON_ID_ROWS = 3000       # orig: 62613, scaled down heavily - see README
N_EEIO_ROWS = 500             # orig: 2170, scaled down
N_EEIO_EF_ROWS = 120          # orig: 159
N_PRODUCT_MAPPING_RAW_ROWS = 2000  # orig: 6550, scaled down
YEARS = [2024, 2025, 2026]

# ------------------------------------------------------------------
# NAME POOLS (fictional, pharma-flavoured, no real company/site names)
# ------------------------------------------------------------------
BUSINESS_DIVISIONS = ["Pharmaceuticals", "Vaccines", "Consumer Healthcare", "Specialty Care"]

COUNTRIES = ["United Kingdom", "Germany", "Belgium", "Ireland", "United States",
             "India", "Switzerland", "France", "Poland", "China", "Singapore"]

SITES = ["Northfield Site", "Rivermill Site", "Eastgate Site", "Solaris Park Site",
         "Meadowbrook Site", "Fenwick Site", "Clearwater Site", "Ashford Site",
         "Bridgeholm Site", "Kingsley Site"]

PARENT_SUPPLIERS = ["NovaChem Holdings", "Helix Group", "Meridian Industries plc",
                     "Atlas Materials Corp", "Cascade Polymer Group", "Quantum Holdings",
                     "Everline Group", "Sterling Industries", "BrightLab Corp", "Pinnacle Chemicals plc"]

SUPPLIER_SUFFIXES = ["Solutions", "Industries", "Fine Chemicals", "Glass Works", "Polymer Group",
                      "Materials Ltd", "International", "Vial Co.", "Excipients Ltd", "Logistics",
                      "Packaging Ltd", "Labs", "Group", "Manufacturing Co."]
SUPPLIER_ROOTS = ["NovaChem", "Helix", "Meridian", "Atlas", "Cascade", "BrightLab", "PharmaPak",
                   "Sterling", "Quantum", "Everline", "Solara", "Ferrolux", "Vantis", "Corex",
                   "Amberline", "Northwell", "Trueform", "Bluepeak", "Ridgeline", "Clarion"]

CATEGORY_TREE = {
    "Raw Materials": {
        "Active Pharmaceutical Ingredients": ["Small Molecule API", "Biologic API", "Peptide API"],
        "Excipients": ["Binders & Fillers", "Coatings", "Preservatives"],
        "Solvents": ["Organic Solvents", "Aqueous Solvents"],
    },
    "Packaging Materials": {
        "Primary Packaging": ["Glass Vials", "Blister Packs", "Prefilled Syringes", "Bottles"],
        "Secondary Packaging": ["Cartons", "Leaflets", "Labels"],
        "Tertiary Packaging": ["Shipping Cases", "Pallet Wrap"],
    },
    "Contract Manufacturing": {
        "Drug Substance CMO": ["Fermentation Services", "Synthesis Services"],
        "Drug Product CMO": ["Fill & Finish", "Packaging Services"],
    },
    "Logistics": {
        "Inbound Freight": ["Road Freight", "Air Freight", "Ocean Freight"],
        "Cold Chain": ["Refrigerated Transport", "Cold Storage"],
    },
    "Capital Equipment": {
        "Process Equipment": ["Reactors & Vessels", "Filling Lines"],
        "Lab Equipment": ["Analytical Instruments"],
    },
    "Lab & Clinical Supplies": {
        "Lab Consumables": ["Reagents", "Single-use Plasticware"],
        "Clinical Trial Materials": ["Comparator Drugs", "Trial Kits"],
    },
}

GPLT_TREE = {
    "Direct Materials": {"APIs & Actives": ["API - Small Molecule", "API - Biologic"],
                          "Packaging": ["Primary Pack", "Secondary Pack"]},
    "Indirect Materials": {"MRO": ["Spare Parts", "Consumables"],
                            "Lab Supplies": ["Reagents", "Plasticware"]},
    "Services": {"Contract Manufacturing": ["Fill & Finish", "Synthesis"],
                 "Professional Services": ["Consulting", "Testing"]},
    "Logistics": {"Freight": ["Road", "Air", "Ocean"], "Warehousing": ["Ambient", "Cold Chain"]},
    "Capital": {"Equipment": ["Process Equipment", "Lab Equipment"]},
}

MATERIAL_DESC_BY_LEVEL3 = {
    "Small Molecule API": ["Paracetamol API", "Amoxicillin API", "Ibuprofen API", "Metformin API"],
    "Biologic API": ["Monoclonal Antibody Bulk", "Recombinant Protein Concentrate"],
    "Peptide API": ["Synthetic Peptide Concentrate"],
    "Binders & Fillers": ["Microcrystalline Cellulose", "Lactose Monohydrate"],
    "Coatings": ["Film Coating Powder", "Enteric Coating Blend"],
    "Preservatives": ["Sodium Benzoate", "Methylparaben"],
    "Organic Solvents": ["Ethanol (Pharma Grade)", "Isopropyl Alcohol"],
    "Aqueous Solvents": ["Water for Injection"],
    "Glass Vials": ["Glass Vial 10ml", "Glass Vial 2ml", "Freeze-dried Vaccine Vial"],
    "Blister Packs": ["PVC Blister Pack", "Alu-Alu Blister Pack"],
    "Prefilled Syringes": ["Prefilled Syringe 1ml", "Prefilled Syringe 2.25ml"],
    "Bottles": ["HDPE Bottle 100ml", "HDPE Bottle 250ml"],
    "Cartons": ["Corrugated Shipping Box", "Folding Carton"],
    "Leaflets": ["Patient Information Leaflet"],
    "Labels": ["Pressure-sensitive Label"],
    "Shipping Cases": ["Corrugated Shipping Case", "Reusable Shipping Tote"],
    "Pallet Wrap": ["Stretch Pallet Wrap"],
    "Fermentation Services": ["Fermentation Batch Service"],
    "Synthesis Services": ["Custom Synthesis Batch"],
    "Fill & Finish": ["Aseptic Fill & Finish Service"],
    "Packaging Services": ["Contract Packaging Service"],
    "Road Freight": ["Inbound Road Freight - Pallet"],
    "Air Freight": ["Inbound Air Freight - Temperature Controlled"],
    "Ocean Freight": ["Inbound Ocean Freight - Container"],
    "Refrigerated Transport": ["Cold Chain Transport - 2-8C"],
    "Cold Storage": ["Cold Storage - Warehouse Pallet Slot"],
    "Reactors & Vessels": ["Stainless Steel Reactor Component"],
    "Filling Lines": ["Filling Line Spare Parts"],
    "Analytical Instruments": ["HPLC Consumable Kit"],
    "Reagents": ["Lab Reagent Kit"],
    "Single-use Plasticware": ["Single-use Bioreactor Bag", "Pipette Tips (case)"],
    "Comparator Drugs": ["Comparator Drug Batch"],
    "Trial Kits": ["Clinical Trial Kit"],
}

UOM_CHOICES = ["kg", "litre", "unit", "tonne"]
GHG_CATEGORIES = ["Category 1 - Purchased Goods and Services",
                   "Category 2 - Capital Goods",
                   "Category 4 - Upstream Transportation and Distribution",
                   "Category 5 - Waste Generated in Operations",
                   "Category 12 - End of Life Treatment of Sold Products"]

SOURCE_SYSTEMS = ["SAP Ariba", "Coupa", "S/4HANA Procurement"]

PRODUCT_BRANDS = ["Advelra", "Brenzolix", "Calmera", "Dermafyx", "Estrivon", "Florivex",
                  "Glucovex", "Hemazol", "Immunara", "Kaldrin", "Lumivax", "Mendovia",
                  "Norvelin", "Ostreva", "Pulmatrix", "Quilava", "Renovex", "Sentrivax",
                  "Torvexa", "Ulvatrix", "Vezanta", "Wintrelis", "Xantivo", "Yenzura", "Zolvarin"]

FIRST_NAMES = ["Elena", "Marcus", "Priya", "Noah", "Sofia", "Liam", "Amara", "Lucas", "Nadia",
               "Oliver", "Freya", "Ravi", "Ingrid", "Diego", "Yuki", "Hannah", "Tariq", "Clara",
               "Benjamin", "Fatima", "Alex", "Maya", "Jonas", "Zara"]
LAST_NAMES = ["Berg", "Whitfield", "Kapoor", "Larsen", "Novak", "Reyes", "Fontaine", "Adeyemi",
              "Sorensen", "Kowalski", "Duarte", "Lindqvist", "Osei", "Bianchi", "Haddad", "Tanaka"]

# ------------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------------

def flatten_category_tree(tree):
    """returns list of (l1, l2, l3)"""
    out = []
    for l1, l2s in tree.items():
        for l2, l3s in l2s.items():
            for l3 in l3s:
                out.append((l1, l2, l3))
    return out

CATEGORY_LEAVES = flatten_category_tree(CATEGORY_TREE)   # ~30 combos
GPLT_LEAVES = flatten_category_tree(GPLT_TREE)            # ~10 combos


def make_supplier_pool(n):
    names = set()
    suppliers = []
    while len(suppliers) < n:
        name = f"{random.choice(SUPPLIER_ROOTS)} {random.choice(SUPPLIER_SUFFIXES)}"
        if name in names:
            continue
        names.add(name)
        suppliers.append({
            "supplier_name": name,
            "supplier_number": f"SUP-{10000 + len(suppliers):05d}",
            "parent_supplier_name": random.choice(PARENT_SUPPLIERS),
            "supplier_country": random.choice(COUNTRIES),
            "supplier_city": random.choice(["Riverton", "Oakhaven", "Millbridge", "Stonegate",
                                             "Harborview", "Fairmont", "Brookfield", "Castlewood"]),
        })
    return suppliers


def make_material_pool(n):
    materials = []
    all_leaves = list(MATERIAL_DESC_BY_LEVEL3.items())
    i = 0
    while len(materials) < n:
        level3, descs = all_leaves[i % len(all_leaves)]
        desc = random.choice(descs)
        # find l1/l2 for this l3
        l1, l2 = next((l1, l2) for l1, l2s in CATEGORY_TREE.items() for l2, l3s in l2s.items() if level3 in l3s)
        materials.append({
            "material_code": f"MAT-{20000 + len(materials):05d}",
            "material_description": desc,
            "category_level_1_enriched": l1,
            "category_level_2_enriched": l2,
            "category_level_3_enriched": level3,
            "category_level_4_enriched": f"{level3} - Grade {random.choice(['A', 'B', 'Std', 'Premium'])}",
        })
        i += 1
    return materials


def rand_float(lo, hi, nd=4):
    return round(random.uniform(lo, hi), nd)


def write_csv(name, fieldnames, rows):
    path = os.path.join(OUT_DIR, f"{name}.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print(f"wrote {len(rows):>6} rows -> {path}")


# ------------------------------------------------------------------
# BUILD
# ------------------------------------------------------------------

suppliers = make_supplier_pool(N_SUPPLIERS)
materials = make_material_pool(N_MATERIALS)

# ---- users ----
ROLE_POOL = ["Expert EF Reviewer", "Standard EF Reviewer", "EF Approver",
             "Project Owner", "Project Reviewer"]
users = []
used_names = set()
for i in range(18):
    while True:
        name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
        if name not in used_names:
            used_names.add(name)
            break
    n_roles = random.choice([1, 1, 1, 2])
    roles = random.sample(ROLE_POOL, n_roles)
    users.append({
        "user_id": f"U-{1000 + i}",
        "name": name,
        "roles": "{" + ",".join(f'"{r}"' for r in roles) + "}",
        "open_ef_reviews": random.randint(0, 6) if any("Reviewer" in r for r in roles) else 0,
        "open_ef_approvals": random.randint(0, 4) if "EF Approver" in roles else 0,
    })
write_csv("users", ["user_id", "name", "roles", "open_ef_reviews", "open_ef_approvals"], users)

# ---- ef_sources_methods_assurance (fixed reference data from the deck's table image) ----
esma_rows = [
    ("EF Source", 1, "Supplier/manufacturer", "Supplier PCF, supplier LCA or supplier EPD", None),
    ("EF Source", 2, "Internal calculation", "Internal LCA, engineering calculation or internally combined sources", None),
    ("EF Source", 3, "EF database", "ecoinvent, Sphera/GaBi, CEDA, EXIOBASE, etc.", None),
    ("EF Source", 4, "Published authoritative source", "Government, industry association, EPD programme or academic publication", None),
    ("EF Source", 5, "Other/unknown", "Consultant, legacy EF or source not documented", None),
    ("EF Methodology", 1, "Recognized product LCA/PCF standard", "ISO 14067, ISO 14040/44, GHG Protocol Product Standard, PAS 2050", None),
    ("EF Methodology", 2, "Sector-specific methodology or PCR", "TfS, PACT, PAS 2090, ISO 14025 EPD with applicable PCR", None),
    ("EF Methodology", 3, "Process/activity-based calculation", "Process LCA, engineering calculation, measurement or mass balance", None),
    ("EF Methodology", 4, "Hybrid or spend-based calculation", "Hybrid LCA, EEIO or spend-based EF", None),
    ("EF Methodology", 5, "Proxy/other/unknown methodology", "Adjusted EF, extrapolation, undocumented or other method", None),
    ("EF Assurance", 1, "Independently verified", "Third-party verification or verified EPD", "Standard Reviewer"),
    ("EF Assurance", 2, "Independently reviewed / quality-assured", "Critical review, peer review or database QA process", "Standard Reviewer"),
    ("EF Assurance", 3, "Internally or customer reviewed", "Documented internal or second-party review", "Standard Reviewer"),
    ("EF Assurance", 4, "Unverified but documented", "Full or partial methodology/calculation available", "Expert Reviewer"),
    ("EF Assurance", 5, "Unverified/unknown", "Single EF value, unsupported declaration or no assurance information", "Expert Reviewer"),
]
esma = [{"category": c, "option_no": o, "option_label": l, "includes_text": inc, "review_route": rr or ""}
        for c, o, l, inc, rr in esma_rows]
write_csv("ef_sources_methods_assurance", ["category", "option_no", "option_label", "includes_text", "review_route"], esma)

# ---- common_id + global_factors_inventory ----
# partition ALL materials plus extra background materials into common_id1 buckets
extra_bg_materials = [f"MAT-{29000 + i:05d}" for i in range(max(0, N_COMMON_ID_ROWS - N_MATERIALS))]
all_material_ids = [m["material_code"] for m in materials] + extra_bg_materials
common_id1_list = [f"CID-{500 + i:04d}" for i in range(N_COMMON_ID_BUCKETS)]

common_id_rows = []
material_to_bucket = {}
bucket_cycle = 0
for mid in all_material_ids:
    bucket = common_id1_list[bucket_cycle % len(common_id1_list)]
    bucket_cycle += 1
    material_to_bucket[mid] = bucket
    desc = next((m["material_description"] for m in materials if m["material_code"] == mid), "Background Material")
    common_id_rows.append({
        "material_id": mid,
        "material_description": desc,
        "common_id1": bucket,
        "primary_material_weight_g": rand_float(1, 5000, 2),
        "comment": random.choice(["", "", "legacy mapping", "confirmed 2025 review"]),
        "invoice_paid_date": f"{random.choice(YEARS)}-{random.randint(1,12):02d}-{random.randint(1,28):02d}",
        "year": random.choice(YEARS),
    })
    if len(common_id_rows) >= N_COMMON_ID_ROWS:
        break
write_csv("common_id", ["material_id", "material_description", "common_id1", "primary_material_weight_g",
                         "comment", "invoice_paid_date", "year"], common_id_rows)

gfi_rows = []
for bucket in common_id1_list:
    base_value = rand_float(0.5, 900, 4)
    for j, hist_name in enumerate(random.sample(
            ["Legacy EF v1", "Legacy EF v2", "Database Default", "Industry Average", "Prior Year EF"],
            k=random.randint(2, 4))):
        gfi_rows.append({
            "common_id1": bucket,
            "emission_factor_name_historic": f"{hist_name} - {bucket}",
            "co2_emission_factor_current": round(base_value * (1 + j * 0.05), 4),
        })
write_csv("global_factors_inventory", ["common_id1", "emission_factor_name_historic", "co2_emission_factor_current"], gfi_rows)

# ---- eeio + eeio_ef ----
classification_for_leaf = {leaf: f"EEIO-{i+1:03d}" for i, leaf in enumerate(CATEGORY_LEAVES)}
eeio_rows = []
for leaf, classification in classification_for_leaf.items():
    l1, l2, l3 = leaf
    for year in YEARS:
        eeio_rows.append({
            "ghg_scope3_category": random.choice(GHG_CATEGORIES),
            "enriched_l1l2l3_classification": classification,
            "category_level_1_enriched": l1,
            "category_level_2_enriched": l2,
            "category_level_3_enriched": l3,
            "year": year,
        })
while len(eeio_rows) < N_EEIO_ROWS:
    leaf = random.choice(CATEGORY_LEAVES)
    l1, l2, l3 = leaf
    eeio_rows.append({
        "ghg_scope3_category": random.choice(GHG_CATEGORIES),
        "enriched_l1l2l3_classification": classification_for_leaf[leaf],
        "category_level_1_enriched": l1,
        "category_level_2_enriched": l2,
        "category_level_3_enriched": l3,
        "year": random.choice(YEARS),
    })
write_csv("eeio", ["ghg_scope3_category", "enriched_l1l2l3_classification", "category_level_1_enriched",
                    "category_level_2_enriched", "category_level_3_enriched", "year"], eeio_rows)

eeio_ef_rows = []
classifications = list(classification_for_leaf.values())
for classification in classifications:
    base = rand_float(0.02, 0.6, 4)
    for year in YEARS[-2:]:
        eeio_ef_rows.append({
            "enriched_l1l2l3_classification": classification,
            "emission_factor_name": f"EEIO EF {classification} {year}",
            "eeio_factor_kgco2e_gbp": round(base * (1.03 if year == YEARS[-1] else 1.0), 4),
            "year": year,
        })
while len(eeio_ef_rows) < N_EEIO_EF_ROWS:
    classification = random.choice(classifications)
    year = random.choice(YEARS)
    eeio_ef_rows.append({
        "enriched_l1l2l3_classification": classification,
        "emission_factor_name": f"EEIO EF {classification} {year} alt",
        "eeio_factor_kgco2e_gbp": rand_float(0.02, 0.6, 4),
        "year": year,
    })
write_csv("eeio_ef", ["enriched_l1l2l3_classification", "emission_factor_name", "eeio_factor_kgco2e_gbp", "year"], eeio_ef_rows)

# ---- material_specific_factors ----
msf_materials = random.sample(materials, int(len(materials) * N_MSF_COVERAGE))
msf_rows = []
for m in msf_materials:
    supplier = random.choice(suppliers)
    n_rows = random.choice([1, 1, 1, 2])
    for _ in range(n_rows):
        msf_rows.append({
            "material_code": m["material_code"],
            "material_description": m["material_description"],
            "supplier_name": supplier["supplier_name"],
            "supplier_id": supplier["supplier_number"],
            "emission_factor_name": f"{m['material_description']} EF - {supplier['supplier_name']}",
            "ef_kgco2e_per_unit": rand_float(0.1, 900, 4),
            "units_per_kg": rand_float(0.5, 3, 4) if random.random() > 0.3 else "",
            "weight_per_unit_kg": rand_float(0.01, 5, 4) if random.random() > 0.3 else "",
        })
write_csv("material_specific_factors",
          ["material_code", "material_description", "supplier_name", "supplier_id",
           "emission_factor_name", "ef_kgco2e_per_unit", "units_per_kg", "weight_per_unit_kg"], msf_rows)

# ---- supplier_ccf_index ----
ccf_rows = []
for s in suppliers:
    base = rand_float(0.05, 1.2, 4)
    for j in range(random.randint(3, N_CCF_HISTORIC_PER_SUPPLIER)):
        ccf_rows.append({
            "supplier_name": s["supplier_name"] if random.random() > 0.15 else "",
            "emission_factor_name": f"Spend EF {s['supplier_name']} v{j+1}",
            "parent_supplier_mapping_initial": s["parent_supplier_name"] if random.random() > 0.15 else "",
            "supplier_number": s["supplier_number"],
            "ef_per_1000_gbp": round(base * (1 + j * 0.02), 4),
        })
write_csv("supplier_ccf_index",
          ["supplier_name", "emission_factor_name", "parent_supplier_mapping_initial", "supplier_number",
           "ef_per_1000_gbp"], ccf_rows)

# ---- product_mapping_raw ----
pmr_rows = []
# each product has a bill-of-materials of 4-10 materials, present across years (composition can drift slightly by year)
product_boms = {p: random.sample(materials, random.randint(4, 10)) for p in PRODUCT_BRANDS}
while len(pmr_rows) < N_PRODUCT_MAPPING_RAW_ROWS:
    product = random.choice(PRODUCT_BRANDS)
    year = random.choice(YEARS)
    bom = product_boms[product]
    mat = random.choice(bom)
    pmr_rows.append({
        "year_of_exercise": year,
        "product_name": product,
        "product_brand": product,
        "material_id_code": mat["material_code"],
        "material_description": mat["material_description"],
        "business_division": random.choice(BUSINESS_DIVISIONS),
        "site": random.choice(SITES),
    })
write_csv("product_mapping_raw",
          ["year_of_exercise", "product_name", "product_brand", "material_id_code", "material_description",
           "business_division", "site"], pmr_rows)

# ---- carbon_app_export (hub table). Two consecutive years per material so the
# EF Entry screen can show genuine YoY emissions trend + % change, per slide 13.
#
# co2_factor_final / co2_factor_name_final are NOT independently randomized -
# each material is assigned exactly ONE authoritative tier (mirroring what the
# real Carbon App's own priority cascade would have resolved), and that tier's
# actual value/name is copied in verbatim. This is what makes the app's
# "trust the export, identify the tier by name-matching against the reference
# tables" approach valid - the name it name-matches against is a name that
# genuinely exists in one of those tables, not a coincidence.
#
# Materials whose tier is spend-based (Supplier Spend EF or CEDA/EEIO) get
# tonnage AND both quantity fields left blank together - a spend-tracked
# transaction never captured a physical quantity dimension at all, not just
# a missing tonnage figure. ----

msf_by_material = {}
for r in msf_rows:
    msf_by_material.setdefault(r["material_code"], []).append(r)

ccf_by_supplier = {}
for r in ccf_rows:
    ccf_by_supplier.setdefault(r["supplier_number"], []).append(r)

common_id1_by_material = {r["material_id"]: r["common_id1"] for r in common_id_rows}

gfi_by_common_id1 = {}
for r in gfi_rows:
    gfi_by_common_id1.setdefault(r["common_id1"], []).append(r)

eeio_ef_by_classification = {}
for r in eeio_ef_rows:
    eeio_ef_by_classification.setdefault(r["enriched_l1l2l3_classification"], []).append(r)


def resolve_authoritative_tier(material, supplier):
    """Picks ONE tier for this material (weighted, but only among tiers that
    actually have matching reference data) and returns
    (tier_label, value, name, unit, is_mass_based)."""
    has_msf = material["material_code"] in msf_by_material
    has_ccf = supplier["supplier_number"] in ccf_by_supplier
    classification = classification_for_leaf.get(
        (material["category_level_1_enriched"], material["category_level_2_enriched"], material["category_level_3_enriched"]))
    has_eeio_ef = classification in eeio_ef_by_classification if classification else False
    common_id1 = common_id1_by_material.get(material["material_code"])
    gfi_candidates = gfi_by_common_id1.get(common_id1, []) if common_id1 else []
    has_gfi = bool(gfi_candidates)

    # Weighted pick among whichever tiers actually resolve for this material -
    # Material Specific favored when available (~85%), otherwise spread
    # across the remaining three so the demo exercises every tier.
    candidates = []
    if has_msf:
        candidates.append(("msf", 0.85))
    if has_ccf:
        candidates.append(("ccf", 0.5 if has_msf else 0.5))
    if has_gfi:
        candidates.append(("gfi", 0.35 if has_msf else 0.35))
    if has_eeio_ef:
        candidates.append(("eeio", 0.15 if has_msf else 0.15))
    tiers, weights = zip(*candidates)
    tier = random.choices(tiers, weights=weights, k=1)[0]

    if tier == "msf":
        row = random.choice(msf_by_material[material["material_code"]])
        return ("Material Specific EF", float(row["ef_kgco2e_per_unit"]), row["emission_factor_name"], "kg CO2e / unit", True)
    if tier == "ccf":
        row = random.choice(ccf_by_supplier[supplier["supplier_number"]])
        return ("Supplier Spend EF (CCF index)", float(row["ef_per_1000_gbp"]), row["emission_factor_name"], "kg CO2e / £1,000 GBP", False)
    if tier == "gfi":
        row = random.choice(gfi_candidates)
        return ("Global EF (Common ID)", float(row["co2_emission_factor_current"]), row["emission_factor_name_historic"], "kg CO2e / kg", True)
    row = random.choice(eeio_ef_by_classification[classification])
    return ("CEDA EF (EEIO mapping)", float(row["eeio_factor_kgco2e_gbp"]), row["emission_factor_name"], "kg CO2e / GBP", False)


cae_material_years = 2
n_cae_materials = max(1, N_CAE_ROWS // cae_material_years)
cae_materials = random.sample(materials, min(n_cae_materials, len(materials)))
cae_years = YEARS[-cae_material_years:]
cae_rows = []
for m in cae_materials:
    supplier = random.choice(suppliers)
    gplt_leaf = random.choice(GPLT_LEAVES)
    base_tonnage = rand_float(0.5, 500, 3)
    base_co2e_mt = rand_float(5, 400, 3)  # used only for spend-based tiers, which have no tonnage to derive from
    drift = random.uniform(-0.15, 0.15)  # YoY drift, same material/supplier across years
    # Resolved ONCE per material, not per year - the authoritative tier a material
    # resolves to doesn't flip year to year on its own; only a newly-approved
    # proposal changes it, which is a forward-looking event this export can't see yet.
    tier_label, ef_value, ef_name, ef_unit, is_mass_based = resolve_authoritative_tier(m, supplier)
    for i, year in enumerate(cae_years):
        factor_mult = (1 + drift) ** i
        if is_mass_based:
            tonnage = round(base_tonnage * random.uniform(0.9, 1.1) * factor_mult, 3)
            co2e_mt = round(ef_value * tonnage, 4)
            invoice_quantity = round(tonnage * random.uniform(900, 1100), 2)
            quantity_corrected = round(tonnage * random.uniform(900, 1100), 2)
        else:
            tonnage = ""
            co2e_mt = round(base_co2e_mt * random.uniform(0.9, 1.1) * factor_mult, 4)
            invoice_quantity = ""
            quantity_corrected = ""
        cae_rows.append({
            "ghg_category": random.choice(GHG_CATEGORIES),
            "source_system": random.choice(SOURCE_SYSTEMS),
            "data_source": random.choice(SOURCE_SYSTEMS),
            "company_code": f"CC-{random.randint(100,199)}",
            "indicator_name": m["material_description"],
            "business_division": random.choice(BUSINESS_DIVISIONS),
            "year": year,
            "site_country": random.choice(COUNTRIES),
            "site_name": random.choice(SITES),
            "parent_supplier_name": supplier["parent_supplier_name"],
            "supplier_name": supplier["supplier_name"],
            "supplier_number": supplier["supplier_number"],
            "supplier_address": f"{random.randint(1,999)} {random.choice(['Industrial Way','Commerce Rd','Harbor Ave','Factory Lane'])}",
            "supplier_city": supplier["supplier_city"],
            "supplier_country": supplier["supplier_country"],
            "category_level_1_enriched": m["category_level_1_enriched"],
            "category_level_2_enriched": m["category_level_2_enriched"],
            "category_level_3_enriched": m["category_level_3_enriched"],
            "category_level_4_enriched": m["category_level_4_enriched"],
            "co2_factor": ef_value,
            "co2_factor_final": ef_value,
            "co2_factor_name_final": ef_name,
            "co2_factor_name_supplier_submissions": f"{m['material_description']} Supplier Submission",
            "gplt": gplt_leaf[0],
            "gplt1": gplt_leaf[1],
            "gplt2": gplt_leaf[2],
            "material": m["material_description"],
            "material_code": m["material_code"],
            "co2e_mt": co2e_mt,
            "tonnage": tonnage,
            "uom": random.choice(UOM_CHOICES) if is_mass_based else "",
            "quantity_corrected": quantity_corrected,
            "invoice_quantity": invoice_quantity,
        })
write_csv("carbon_app_export",
          ["ghg_category", "source_system", "data_source", "company_code", "indicator_name", "business_division",
           "year", "site_country", "site_name", "parent_supplier_name", "supplier_name", "supplier_number",
           "supplier_address", "supplier_city", "supplier_country", "category_level_1_enriched",
           "category_level_2_enriched", "category_level_3_enriched", "category_level_4_enriched", "co2_factor",
           "co2_factor_final", "co2_factor_name_final", "co2_factor_name_supplier_submissions", "gplt", "gplt1",
           "gplt2", "material", "material_code", "co2e_mt", "tonnage", "uom", "quantity_corrected",
           "invoice_quantity"], cae_rows)

print("\nDone. CSV files are in backend/csv/ - import each into its matching Supabase table.")
