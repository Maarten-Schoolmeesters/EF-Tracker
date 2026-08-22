import { store } from "./dataStore.js";

// Stage metadata - text taken verbatim from the requirements deck's process diagram.
export const STAGES = [
  { code: "E1-Draft", label: "E1 · Draft", desc: "Proposal input" },
  { code: "E2-Review", label: "E2 · Review", desc: "Technical validation" },
  { code: "E3-Approval", label: "E3 · Approval", desc: "Business sign-off" },
  { code: "E4-Ready", label: "E4 · Ready", desc: "Carbon App ingestion" },
  { code: "E5-OnHold", label: "E5 · On Hold", desc: "Retained and viewable" },
  { code: "E6-Cancelled", label: "E6 · Cancelled", desc: "View-only" },
];

export const EF_TYPES = [
  "Supplier Materials EF",
  "Supplier Spend EF / CCF index",
  "Global EF - Material to Common ID mapping",
  "CEDA EF - L1/L2/L3 to EEIO mapping",
];

// Sensible EF-Expert-Guidance review checklist, since the deck marks the real
// steps "TBD w/ LCA team" and asks for a reasonable placeholder in the meantime.
export const REVIEW_STEPS = [
  "EF source, methodology and assurance level are consistent with the declared EF type",
  "Evidence link is accessible and supports the stated assurance level",
  "Proposed value has been compared to the current EF; changes over ~20% are flagged and explained",
  "All mandatory fields for this EF type are complete and internally consistent",
  "No conflict of interest between reviewer and proposer/supplier",
];

export function generateChangeId() {
  const year = new Date().getFullYear();
  const existing = store.efProposals
    .map((p) => p.change_id)
    .filter((id) => id && id.startsWith(`EF-${year}-`))
    .map((id) => parseInt(id.split("-")[2], 10))
    .filter((n) => !isNaN(n));
  const next = (existing.length ? Math.max(...existing) : 0) + 1;
  return `EF-${year}-${String(next).padStart(4, "0")}`;
}

// ---- Priority cascade lookups (mirrors the Carbon App's own EF hierarchy, slide 9) ----

export function lookupCurrentEf({ materialCode, supplierNumber, categoryL1, categoryL2, categoryL3 }) {
  if (materialCode) {
    const msf = store.materialSpecificFactors.find((r) => r.material_code === materialCode);
    if (msf) {
      return { tier: "Material Specific EF", name: msf.emission_factor_name, value: Number(msf.ef_kgco2e_per_unit) };
    }
  }
  if (supplierNumber) {
    const ccf = store.supplierCcfIndex.find((r) => r.supplier_number === supplierNumber);
    if (ccf) {
      return { tier: "Supplier Spend EF (CCF index)", name: ccf.emission_factor_name, value: Number(ccf.ef_per_1000_gbp) };
    }
  }
  if (materialCode) {
    const cid = store.commonId.find((r) => r.material_id === materialCode);
    if (cid) {
      const gfi = store.globalFactorsInventory.find((r) => r.common_id1 === cid.common_id1);
      if (gfi) {
        return { tier: "Global EF (Common ID)", name: gfi.emission_factor_name_historic, value: Number(gfi.co2_emission_factor_current), commonId1: cid.common_id1 };
      }
    }
  }
  if (categoryL1 && categoryL2 && categoryL3) {
    const eeioRow = store.eeio.find((r) =>
      r.category_level_1_enriched === categoryL1 &&
      r.category_level_2_enriched === categoryL2 &&
      r.category_level_3_enriched === categoryL3
    );
    if (eeioRow) {
      const ef = store.eeioEf.find((r) => r.enriched_l1l2l3_classification === eeioRow.enriched_l1l2l3_classification);
      if (ef) {
        return { tier: "CEDA EF (EEIO mapping)", name: ef.emission_factor_name, value: Number(ef.eeio_factor_kgco2e_gbp), classification: eeioRow.enriched_l1l2l3_classification };
      }
    }
  }
  return null;
}

// Total company-wide emissions for a given year, used as the denominator for
// "% change vs baseline" impact metrics (an emissions-swing-vs-total-footprint
// view, as opposed to a plain before/after EF-value percentage which doesn't
// depend on tonnage or year at all).
export function yearlyEmissionsBaseline(year) {
  return store.carbonAppExport
    .filter((r) => Number(r.year) === Number(year))
    .reduce((sum, r) => sum + Number(r.co2e_mt || 0), 0);
}

export function pctChange(oldVal, newVal) {
  if (oldVal === null || oldVal === undefined || oldVal === 0 || isNaN(oldVal)) return null;
  return ((newVal - oldVal) / Math.abs(oldVal)) * 100;
}

export function productForMaterial(materialCode) {
  const row = store.productMapping.find((r) => r.material_id_code === materialCode);
  return row ? row.product_name : null;
}

// ---- Review route + auto-assignment (slides 6 & 7) ----

export function reviewRouteForAssurance(assuranceLabel) {
  const row = store.efSourcesMethodsAssurance.find(
    (r) => r.category === "EF Assurance" && r.option_label === assuranceLabel
  );
  return row ? row.review_route : null; // "Expert Reviewer" | "Standard Reviewer"
}

function pickByLowestCount(role, countField) {
  const candidates = store.users.filter((u) => (u.roles || []).includes(role));
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    const diff = (a[countField] || 0) - (b[countField] || 0);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name); // tie-break: alphabetical (not specified in the deck)
  });
  return sorted[0];
}

export function pickReviewer(route) {
  const role = route === "Expert Reviewer" ? "Expert EF Reviewer" : "Standard EF Reviewer";
  return pickByLowestCount(role, "open_ef_reviews");
}

export function pickApprover() {
  return pickByLowestCount("EF Approver", "open_ef_approvals");
}

// ---- New EF Name derivation (slide 12: "standard must be agreed" - proposing a concrete rule) ----

export function deriveEfName({ efType, fields, materialDescription, supplierName, year }) {
  const parts = [efType.split(" ")[0]];
  if (materialDescription) parts.push(materialDescription);
  if (supplierName) parts.push(supplierName);
  if (year) parts.push(String(year));
  return parts.filter(Boolean).join(" · ");
}
