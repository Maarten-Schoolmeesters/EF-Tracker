import { store, currentUser, insertRow, updateRow, logAudit, notify, loadTransactionalData, adjustUserCount } from "../dataStore.js";
import { createFacetFilterGroup } from "../facetFilter.js";
import { toast } from "../toast.js";
import {
  STAGES, EF_TYPES, REVIEW_STEPS, generateChangeId, lookupCurrentEf, pctChange,
  productForMaterial, reviewRouteForAssurance, pickReviewer, pickApprover, deriveEfName,
} from "../efLogic.js";

let draft = null; // in-memory proposal being edited/viewed
let activeStageView = "E1-Draft";
let facetGroup = null;

function esmaOptions(category) {
  return store.efSourcesMethodsAssurance.filter((r) => r.category === category);
}

function blankDraft() {
  return {
    change_id: null, // assigned on first save
    ef_type: EF_TYPES[0],
    status: "E1-Draft",
    frozen: false,
    project_id: null,
    proposer_id: store.currentUserId,
    reviewer_id: null,
    approver_id: null,
    on_hold_from_status: null,
    fields: {},
    common_fields: { source: "", methodology: "", assurance: "", evidence: "", comment: "" },
    derived: {},
    review_steps: REVIEW_STEPS.map((s) => ({ text: s, done: false })),
    approval_notes: "",
    _isNew: true,
  };
}

export function mountEfEntry() {
  document.getElementById("newEfBtn").addEventListener("click", () => {
    draft = blankDraft();
    activeStageView = "E1-Draft";
    renderAll();
  });
  document.getElementById("openChangeIdBtn").addEventListener("click", () => {
    const id = document.getElementById("openChangeIdInput").value.trim();
    openByChangeId(id);
  });
  if (!draft) { draft = blankDraft(); }
  renderAll();
}

function openByChangeId(id) {
  const found = store.efProposals.find((p) => p.change_id.toLowerCase() === id.toLowerCase());
  if (!found) { toast(`No EF proposal found with Change ID "${id}"`, "error"); return; }
  draft = { ...found, _isNew: false };
  activeStageView = draft.status;
  renderAll();
}

export function openProposalById(changeId, stage) {
  const found = store.efProposals.find((p) => p.change_id === changeId);
  if (!found) return;
  draft = { ...found, _isNew: false };
  activeStageView = stage || draft.status;
  document.querySelector('[data-page="ef-entry"]').click();
  renderAll();
}

function renderAll() {
  renderStageTracker();
  renderStageScreen();
}

function stageIndex(code) { return STAGES.findIndex((s) => s.code === code); }

function renderStageTracker() {
  const el = document.getElementById("stageTracker");
  el.innerHTML = "";
  const currentIdx = stageIndex(draft.status);
  STAGES.forEach((s, i) => {
    const box = document.createElement("div");
    const reached = draft._isNew ? s.code === "E1-Draft" : i <= currentIdx || draft.status === s.code;
    box.className = "stage-box" + (s.code === activeStageView ? " current" : "") + (!reached ? " disabled" : "");
    box.innerHTML = `<strong>${s.label}</strong><span>${s.desc}</span>`;
    box.addEventListener("click", () => {
      if (!reached && s.code !== draft.status) return;
      activeStageView = s.code;
      renderStageTracker();
      renderStageScreen();
    });
    el.appendChild(box);
  });
}

function renderStageScreen() {
  const el = document.getElementById("efStageScreens");
  el.innerHTML = "";
  const reached = draft._isNew ? activeStageView === "E1-Draft" : stageIndex(activeStageView) <= stageIndex(draft.status) || draft.status === activeStageView;
  if (!reached) {
    el.innerHTML = `<div class="card empty-state"><div class="empty-icon">–</div><h3>Stage not yet reached</h3><p>This EF proposal has not reached ${activeStageView} yet.</p></div>`;
    return;
  }
  if (activeStageView === "E1-Draft") return renderE1(el);
  if (activeStageView === "E2-Review") return renderE2(el);
  if (activeStageView === "E3-Approval") return renderE3(el);
  if (activeStageView === "E4-Ready") return renderE4(el);
  if (activeStageView === "E5-OnHold") return renderE5(el);
  if (activeStageView === "E6-Cancelled") return renderE6(el);
}

// ============================================================
// E1 - DRAFT
// ============================================================
function renderE1(el) {
  const frozen = draft.frozen;
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<div class="card-head"><div><h2>EF Entry · E1 Draft</h2><p>Enter a new EF proposal, or continue one still in Draft.</p></div></div>`;
  if (frozen) {
    card.innerHTML += `<div class="notice lock-notice">This proposal is frozen at ${draft.status}. Use the stage's Return action to reopen editing.</div>`;
  }

  const layout = document.createElement("div");
  layout.className = "grid two-col";

  const left = document.createElement("div");
  left.innerHTML = `
    <div class="field" style="max-width:360px;margin-bottom:16px">
      <label>EF Type <span class="req">*</span></label>
      <select id="efTypeSelect" ${frozen ? "disabled" : ""}>
        ${EF_TYPES.map((t) => `<option value="${t}" ${t === draft.ef_type ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>
    <div id="typeSpecificArea"></div>
    <div id="alwaysFieldsArea"></div>
  `;

  const right = document.createElement("div");
  right.innerHTML = `
    <div class="card" id="derivedCard"><h3>Derived info</h3><div id="derivedRows"></div></div>
    <div class="card" id="impactCard"><h3>Reference data & impact</h3><div id="impactArea"></div></div>
  `;

  layout.appendChild(left);
  layout.appendChild(right);
  card.appendChild(layout);

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `
    <button class="btn ghost danger" id="clearBtn" ${frozen ? "disabled" : ""}>Clear form</button>
    <button class="btn" id="saveDraftBtn" ${frozen ? "disabled" : ""}>Save draft</button>
    <button class="btn primary" id="submitReviewBtn" ${frozen ? "disabled" : ""}>Submit for review</button>
  `;
  card.appendChild(actions);
  el.appendChild(card);

  document.getElementById("efTypeSelect").addEventListener("change", (e) => {
    draft.ef_type = e.target.value;
    draft.fields = {};
    renderTypeSpecific();
  });
  renderTypeSpecific();
  renderAlwaysFields();

  document.getElementById("clearBtn").addEventListener("click", () => {
    draft = blankDraft();
    renderAll();
  });
  document.getElementById("saveDraftBtn").addEventListener("click", () => saveDraft(false));
  document.getElementById("submitReviewBtn").addEventListener("click", () => saveDraft(true));

  function renderTypeSpecific() {
    const area = document.getElementById("typeSpecificArea");
    area.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "section-title";
    wrap.innerHTML = `<h4>${draft.ef_type}</h4>`;
    area.appendChild(wrap);
    const facetContainer = document.createElement("div");
    area.appendChild(facetContainer);
    const numericContainer = document.createElement("div");
    numericContainer.className = "field-grid";
    numericContainer.style.marginTop = "12px";
    area.appendChild(numericContainer);

    if (draft.ef_type === "Supplier Materials EF") {
      facetGroup = createFacetFilterGroup({
        container: facetContainer,
        rows: store.carbonAppExport,
        facets: [
          { key: "gplt", label: "GPLT" },
          { key: "gplt1", label: "GPLT1" },
          { key: "gplt2", label: "GPLT2" },
          { key: "parent_supplier_name", label: "Parent Supplier Name" },
          { key: "supplier_name", label: "Supplier Name" },
          { key: "material", label: "Material" },
          { key: "material_code", label: "Material Code", required: true },
        ],
        initialSelections: draft.fields.facets,
        onChange: () => updateDerivedAndImpact(),
      });
      numericContainer.innerHTML = `
        <div class="field"><label>New EF Value <span class="req">*</span></label><input type="number" step="0.0001" id="newEfValue" value="${draft.fields.newEfValue ?? ""}"></div>
        <div class="field"><label>New EF Unit <span class="req">*</span></label>
          <select id="newEfUnit"><option value="">Select unit</option>
            ${["kg CO2e / unit", "kg CO2e / kg", "kg CO2e / tonne"].map((u) => `<option ${draft.fields.newEfUnit === u ? "selected" : ""}>${u}</option>`).join("")}
          </select></div>
        <div class="field"><label>Unit Mass (kg) <span class="req">*</span></label><input type="number" step="0.0001" id="unitMass" value="${draft.fields.unitMass ?? ""}"></div>
      `;
    } else if (draft.ef_type === "Supplier Spend EF / CCF index") {
      facetGroup = createFacetFilterGroup({
        container: facetContainer,
        rows: store.carbonAppExport,
        facets: [
          { key: "supplier_name", label: "Supplier Name", required: true },
          { key: "supplier_number", label: "Supplier Number", required: true },
        ],
        initialSelections: draft.fields.facets,
        onChange: () => updateDerivedAndImpact(),
      });
      numericContainer.innerHTML = `
        <div class="field"><label>New EF Value (per 1,000 GBP) <span class="req">*</span></label><input type="number" step="0.0001" id="newEfValue" value="${draft.fields.newEfValue ?? ""}"></div>
      `;
    } else if (draft.ef_type === "Global EF - Material to Common ID mapping") {
      facetGroup = createFacetFilterGroup({
        container: facetContainer,
        rows: store.commonId,
        facets: [{ key: "common_id1", label: "Common ID1", required: true }],
        initialSelections: draft.fields.facets,
        onChange: () => updateDerivedAndImpact(),
      });
      numericContainer.innerHTML = `
        <div class="field"><label>New EF Value (kg CO2e / kg) <span class="req">*</span></label><input type="number" step="0.0001" id="newEfValue" value="${draft.fields.newEfValue ?? ""}"></div>
      `;
    } else {
      facetGroup = createFacetFilterGroup({
        container: facetContainer,
        rows: store.eeioEf,
        facets: [{ key: "enriched_l1l2l3_classification", label: "Enriched L1L2L3 to EEIO Classification", required: true }],
        initialSelections: draft.fields.facets,
        onChange: () => updateDerivedAndImpact(),
      });
      numericContainer.innerHTML = `
        <div class="field"><label>New EF Value (kg CO2e / GBP) <span class="req">*</span></label><input type="number" step="0.0001" id="newEfValue" value="${draft.fields.newEfValue ?? ""}"></div>
      `;
    }
    ["newEfValue", "newEfUnit", "unitMass"].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.addEventListener("input", () => updateDerivedAndImpact());
    });
    if (frozen) area.querySelectorAll("input,select").forEach((n) => (n.disabled = true));
    updateDerivedAndImpact();
  }

  function renderAlwaysFields() {
    const area = document.getElementById("alwaysFieldsArea");
    area.innerHTML = `
      <div class="section-title"><h4>Source, methodology & evidence</h4></div>
      <div class="field-grid">
        <div class="field"><label>Source of new EF <span class="req">*</span></label>
          <select id="sourceSelect"><option value="">Select source</option>${esmaOptions("EF Source").map((o) => `<option ${draft.common_fields.source === o.option_label ? "selected" : ""}>${o.option_label}</option>`).join("")}</select></div>
        <div class="field"><label>Methodology standard <span class="req">*</span></label>
          <select id="methodSelect"><option value="">Select methodology</option>${esmaOptions("EF Methodology").map((o) => `<option ${draft.common_fields.methodology === o.option_label ? "selected" : ""}>${o.option_label}</option>`).join("")}</select></div>
        <div class="field"><label>Assurance <span class="req">*</span></label>
          <select id="assuranceSelect"><option value="">Select assurance</option>${esmaOptions("EF Assurance").map((o) => `<option ${draft.common_fields.assurance === o.option_label ? "selected" : ""}>${o.option_label}</option>`).join("")}</select></div>
        <div class="field span-2"><label>Evidence link to SharePoint <span class="req">*</span></label><input type="url" id="evidenceInput" placeholder="https://…" value="${draft.common_fields.evidence || ""}"></div>
        <div class="field span-2"><label>Proposer comment</label><textarea id="commentInput">${draft.common_fields.comment || ""}</textarea></div>
      </div>
    `;
    ["sourceSelect", "methodSelect", "assuranceSelect", "evidenceInput", "commentInput"].forEach((id) => {
      document.getElementById(id).addEventListener("input", () => updateDerivedAndImpact());
    });
    if (frozen) area.querySelectorAll("input,select,textarea").forEach((n) => (n.disabled = true));
  }
}

function readFormIntoDraft() {
  const facets = facetGroup ? facetGroup.getSelections() : {};
  draft.fields.facets = facets;
  const val = (id) => document.getElementById(id)?.value;
  draft.fields.newEfValue = val("newEfValue") ? Number(val("newEfValue")) : null;
  draft.fields.newEfUnit = val("newEfUnit") || null;
  draft.fields.unitMass = val("unitMass") ? Number(val("unitMass")) : null;
  draft.common_fields.source = val("sourceSelect") || "";
  draft.common_fields.methodology = val("methodSelect") || "";
  draft.common_fields.assurance = val("assuranceSelect") || "";
  draft.common_fields.evidence = val("evidenceInput") || "";
  draft.common_fields.comment = val("commentInput") || "";
}

function updateDerivedAndImpact() {
  readFormIntoDraft();
  const matchingRows = facetGroup ? facetGroup.getMatchingRows() : [];
  const facets = draft.fields.facets || {};

  let materialCodes = [];
  let supplierNumber = null;
  let commonId1s = [];
  let classifications = [];

  if (draft.ef_type === "Supplier Materials EF") {
    materialCodes = facets.material_code || [];
  } else if (draft.ef_type === "Supplier Spend EF / CCF index") {
    supplierNumber = (facets.supplier_number || [])[0] || null;
  } else if (draft.ef_type === "Global EF - Material to Common ID mapping") {
    commonId1s = facets.common_id1 || [];
  } else {
    classifications = facets.enriched_l1l2l3_classification || [];
  }

  const route = reviewRouteForAssurance(draft.common_fields.assurance);
  const reviewer = route ? pickReviewer(route) : null;
  const approver = pickApprover();
  const proposer = currentUser();

  let efName = "";
  let productBrand = "—";
  if (draft.ef_type === "Supplier Materials EF" && materialCodes.length) {
    const latestRow = store.carbonAppExport
      .filter((r) => r.material_code === materialCodes[0])
      .sort((a, b) => a.year - b.year)
      .pop();
    efName = deriveEfName({ efType: draft.ef_type, materialDescription: latestRow?.material, supplierName: latestRow?.supplier_name, year: latestRow?.year });
    const brands = [...new Set(materialCodes.map((mc) => productForMaterial(mc)).filter(Boolean))];
    productBrand = brands.length === 1 ? brands[0] : brands.length > 1 ? "Multiple products" : "No linked product";
  } else if (draft.ef_type === "Supplier Spend EF / CCF index" && matchingRows.length) {
    efName = deriveEfName({ efType: draft.ef_type, supplierName: matchingRows[0].supplier_name, year: matchingRows[0].year });
  } else if (commonId1s.length) {
    efName = deriveEfName({ efType: draft.ef_type, materialDescription: commonId1s[0] });
  } else if (classifications.length) {
    efName = deriveEfName({ efType: draft.ef_type, materialDescription: classifications[0] });
  }

  draft.derived = {
    changeId: draft.change_id || "Assigned on first save",
    newEfName: efName || "—",
    reviewRoute: route || "—",
    reviewerName: reviewer ? reviewer.name : "—",
    approverName: approver ? approver.name : "—",
    proposerName: proposer ? proposer.name : "—",
    productBrand,
  };

  document.getElementById("derivedRows").innerHTML = `
    ${derivedRow("Project ID", "Non-project (no linked project)")}
    ${derivedRow("Change ID", draft.derived.changeId)}
    ${derivedRow("New EF Name", draft.derived.newEfName)}
    ${derivedRow("Proposed Review Route", draft.derived.reviewRoute)}
    ${derivedRow("Reviewer (auto-assigned)", draft.derived.reviewerName)}
    ${derivedRow("Approver (auto-assigned)", draft.derived.approverName)}
    ${derivedRow("Change Proposer", draft.derived.proposerName)}
    ${derivedRow("Linked Product", draft.derived.productBrand)}
  `;

  renderImpact({ materialCodes, supplierNumber, commonId1s, classifications, matchingRows });
}

function derivedRow(k, v) {
  return `<div class="derived-row"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

function renderImpact({ materialCodes, supplierNumber, commonId1s, classifications, matchingRows }) {
  const area = document.getElementById("impactArea");
  const newVal = draft.fields.newEfValue;

  if (draft.ef_type === "Supplier Materials EF") {
    if (!materialCodes.length) { area.innerHTML = `<p class="empty">Select at least one Material Code.</p>`; return; }
    let totalDeltaCo2 = 0, totalPrevCo2 = 0;
    const rowsHtml = materialCodes.map((mc) => {
      const caeRows = store.carbonAppExport.filter((r) => r.material_code === mc).sort((a, b) => a.year - b.year);
      const latest = caeRows[caeRows.length - 1];
      const current = lookupCurrentEf({ materialCode: mc, supplierNumber: latest?.supplier_number, categoryL1: latest?.category_level_1_enriched, categoryL2: latest?.category_level_2_enriched, categoryL3: latest?.category_level_3_enriched });
      const change = current && newVal ? pctChange(current.value, newVal) : null;
      const twoYearSum = caeRows.reduce((s, r) => s + Number(r.co2e_mt || 0), 0);
      const deltaCo2 = current && newVal ? (newVal - current.value) * (latest?.tonnage || 0) / 1000 : 0;
      totalDeltaCo2 += deltaCo2 || 0;
      totalPrevCo2 += twoYearSum;
      return `<tr>
        <td>${mc}</td><td>${latest?.indicator_name || latest?.material || "—"}</td><td>${latest?.uom || "—"}</td>
        <td>${current ? current.name : "None found"}</td><td>${current ? current.tier : "—"}</td>
        <td>${caeRows.map((r) => `${r.year}: ${Number(r.co2e_mt).toFixed(2)}t`).join(" / ")}</td>
        <td>${change !== null ? change.toFixed(1) + "%" : "—"}</td>
        <td>${deltaCo2 ? deltaCo2.toFixed(2) + "t" : "—"}</td>
      </tr>`;
    }).join("");
    area.innerHTML = `<div class="table-scroll"><table>
      <thead><tr><th>Material Code</th><th>Indicator</th><th>UoM</th><th>Current EF Name</th><th>Current EF Type</th><th>Prev. 2yr emissions</th><th>% Change</th><th>ΔCO2 (S3-1a)</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr><td colspan="5"><strong>Total</strong></td><td>${totalPrevCo2.toFixed(2)}t</td><td></td><td>${totalDeltaCo2.toFixed(2)}t</td></tr></tfoot>
    </table></div>`;
  } else if (draft.ef_type === "Supplier Spend EF / CCF index") {
    if (!supplierNumber) { area.innerHTML = `<p class="empty">Select a Supplier Name / Number.</p>`; return; }
    const current = lookupCurrentEf({ supplierNumber });
    const change = current && newVal ? pctChange(current.value, newVal) : null;
    area.innerHTML = `
      ${derivedRow("Current EF Name", current ? current.name : "None found")}
      ${derivedRow("Current EF Value (per 1,000 GBP)", current ? current.value : "—")}
      ${derivedRow("% Change of EF", change !== null ? change.toFixed(1) + "%" : "—")}
    `;
  } else if (draft.ef_type === "Global EF - Material to Common ID mapping") {
    if (!commonId1s.length) { area.innerHTML = `<p class="empty">Select a Common ID1.</p>`; return; }
    const cid = commonId1s[0];
    const gfi = store.globalFactorsInventory.find((r) => r.common_id1 === cid);
    const change = gfi && newVal ? pctChange(Number(gfi.co2_emission_factor_current), newVal) : null;
    const linkedMaterials = store.commonId.filter((r) => r.common_id1 === cid).map((r) => r.material_id);
    area.innerHTML = `
      ${derivedRow("Current EF Name", gfi ? gfi.emission_factor_name_historic : "None found")}
      ${derivedRow("Current EF Value (kg CO2e/kg)", gfi ? gfi.co2_emission_factor_current : "—")}
      ${derivedRow("% Change of EF", change !== null ? change.toFixed(1) + "%" : "—")}
      ${derivedRow("Material IDs linked to this Common ID", linkedMaterials.length ? linkedMaterials.slice(0, 12).join(", ") + (linkedMaterials.length > 12 ? ` … (+${linkedMaterials.length - 12} more)` : "") : "None")}
    `;
  } else {
    if (!classifications.length) { area.innerHTML = `<p class="empty">Select an EEIO classification.</p>`; return; }
    const cls = classifications[0];
    const ef = store.eeioEf.find((r) => r.enriched_l1l2l3_classification === cls);
    const change = ef && newVal ? pctChange(Number(ef.eeio_factor_kgco2e_gbp), newVal) : null;
    const eeioRow = store.eeio.find((r) => r.enriched_l1l2l3_classification === cls);
    const linkedMaterials = eeioRow
      ? store.carbonAppExport.filter((r) =>
          r.category_level_1_enriched === eeioRow.category_level_1_enriched &&
          r.category_level_2_enriched === eeioRow.category_level_2_enriched &&
          r.category_level_3_enriched === eeioRow.category_level_3_enriched
        ).map((r) => r.material_code)
      : [];
    area.innerHTML = `
      ${derivedRow("Current EF Name", ef ? ef.emission_factor_name : "None found")}
      ${derivedRow("Current EF Value (kg CO2e/GBP)", ef ? ef.eeio_factor_kgco2e_gbp : "—")}
      ${derivedRow("% Change of EF", change !== null ? change.toFixed(1) + "%" : "—")}
      ${derivedRow("Material IDs linked to this classification", [...new Set(linkedMaterials)].join(", ") || "None")}
    `;
  }
}

function validateMandatory() {
  const missing = [];
  const facets = draft.fields.facets || {};
  if (draft.ef_type === "Supplier Materials EF") {
    if (!(facets.material_code || []).length) missing.push("Material Code");
    if (!draft.fields.newEfValue) missing.push("New EF Value");
    if (!draft.fields.newEfUnit) missing.push("New EF Unit");
    if (!draft.fields.unitMass) missing.push("Unit Mass (kg)");
  } else if (draft.ef_type === "Supplier Spend EF / CCF index") {
    if (!(facets.supplier_name || []).length) missing.push("Supplier Name");
    if (!(facets.supplier_number || []).length) missing.push("Supplier Number");
    if (!draft.fields.newEfValue) missing.push("New EF Value");
  } else if (draft.ef_type === "Global EF - Material to Common ID mapping") {
    if (!(facets.common_id1 || []).length) missing.push("Common ID1");
    if (!draft.fields.newEfValue) missing.push("New EF Value");
  } else {
    if (!(facets.enriched_l1l2l3_classification || []).length) missing.push("EEIO Classification");
    if (!draft.fields.newEfValue) missing.push("New EF Value");
  }
  if (!draft.common_fields.source) missing.push("Source of new EF");
  if (!draft.common_fields.methodology) missing.push("Methodology standard");
  if (!draft.common_fields.assurance) missing.push("Assurance");
  if (!draft.common_fields.evidence) missing.push("Evidence link");
  return missing;
}

async function saveDraft(submitForReview) {
  readFormIntoDraft();
  if (submitForReview) {
    const missing = validateMandatory();
    if (missing.length) { toast(`Missing mandatory fields: ${missing.join(", ")}`, "error"); return; }
  }

  const isFirstSave = draft._isNew;
  if (isFirstSave) draft.change_id = generateChangeId();

  const route = reviewRouteForAssurance(draft.common_fields.assurance);
  const reviewer = route ? pickReviewer(route) : null;
  const approver = pickApprover();
  draft.derived.newEfName = draft.derived.newEfName || "—";
  draft.derived.changeId = draft.change_id;

  const payload = {
    change_id: draft.change_id,
    ef_type: draft.ef_type,
    status: submitForReview ? "E2-Review" : "E1-Draft",
    frozen: submitForReview,
    project_id: null,
    proposer_id: store.currentUserId,
    reviewer_id: reviewer ? reviewer.user_id : null,
    approver_id: approver ? approver.user_id : null,
    fields: draft.fields,
    common_fields: draft.common_fields,
    derived: draft.derived,
    review_steps: draft.review_steps,
  };

  try {
    if (isFirstSave) {
      await insertRow("ef_proposals", payload);
      await logAudit("Create draft", "ef_proposal", draft.change_id, null, payload);
      if (submitForReview) await logAudit("Submit for review", "ef_proposal", draft.change_id, { status: "E1-Draft" }, { status: "E2-Review" });
    } else {
      await updateRow("ef_proposals", "change_id", draft.change_id, payload);
      await logAudit(submitForReview ? "Submit for review" : "Save draft", "ef_proposal", draft.change_id, null, payload);
    }
    if (submitForReview) {
      await insertRow("ef_proposal_versions", { change_id: draft.change_id, version_no: 1, stage: "E2-Review", snapshot: payload, changed_by: store.currentUserId });
      if (reviewer) {
        await adjustUserCount(reviewer.user_id, "open_ef_reviews", 1);
        await notify(reviewer.user_id, `You were assigned to review ${draft.change_id}`, draft.change_id);
      }
      toast(`${draft.change_id} submitted for review`, "success");
    } else {
      toast(`${draft.change_id} saved as draft`, "success");
    }
    Object.assign(draft, payload);
    draft._isNew = false;
    await loadTransactionalData();
    activeStageView = payload.status;
    renderAll();
  } catch (e) {
    console.error(e);
  }
}

// ============================================================
// E2 - REVIEW / E3 - APPROVAL / E4 - READY / E5 - ON HOLD / E6 - CANCELLED
// ============================================================

function summaryRows(p) {
  const facets = p.fields.facets || {};
  const rows = [
    ["Change ID", p.change_id], ["EF Type", p.ef_type], ["Status", p.status],
    ["New EF Value", p.fields.newEfValue], ["New EF Unit", p.fields.newEfUnit || "—"],
  ];
  Object.entries(facets).forEach(([k, v]) => rows.push([k, (v || []).join(", ") || "—"]));
  rows.push(["Source", p.common_fields.source], ["Methodology", p.common_fields.methodology],
    ["Assurance", p.common_fields.assurance], ["Evidence", p.common_fields.evidence || "—"],
    ["New EF Name", p.derived.newEfName], ["Reviewer", p.derived.reviewerName], ["Approver", p.derived.approverName],
    ["Proposer", p.derived.proposerName]);
  return rows.map(([k, v]) => derivedRow(k, v ?? "—")).join("");
}

function renderE2(el) {
  const p = draft;
  const card = document.createElement("div");
  card.className = "card";
  const canAct = p.status === "E2-Review";
  card.innerHTML = `
    <div class="card-head"><div><h2>EF Entry · E2 Review<span class="tbd-tag">Details TBD w/ LCA team</span></h2><p>Reviewer validates the proposal against EF Expert Guidance before it can move to Approval.</p></div></div>
    <div class="grid two-col">
      <div>${summaryRows(p)}</div>
      <div>
        <h3>EF Expert Guidance checklist</h3>
        <div class="checklist" id="checklist">
          ${(p.review_steps || []).map((s, i) => `<label><input type="checkbox" data-i="${i}" ${s.done ? "checked" : ""} ${canAct ? "" : "disabled"}> ${s.text}</label>`).join("")}
        </div>
      </div>
    </div>
    <div class="actions">
      <button class="btn ghost danger" id="onHoldBtn" ${canAct ? "" : "disabled"}>Put On Hold</button>
      <button class="btn ghost danger" id="cancelBtn" ${canAct ? "" : "disabled"}>Cancel</button>
      <button class="btn ghost danger" id="returnDraftBtn" ${canAct ? "" : "disabled"}>Return for Revision</button>
      <button class="btn primary" id="submitApprovalBtn" ${canAct ? "" : "disabled"}>Submit for Approval</button>
    </div>
  `;
  el.appendChild(card);
  card.querySelectorAll('#checklist input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => { p.review_steps[Number(cb.dataset.i)].done = cb.checked; });
  });
  document.getElementById("returnDraftBtn").addEventListener("click", () => transitionStage("E1-Draft", { frozen: false }, "Return for revision", [[p.reviewer_id, "open_ef_reviews", -1]]));
  document.getElementById("submitApprovalBtn").addEventListener("click", () => {
    if (!p.review_steps.every((s) => s.done)) { toast("Complete every checklist step before sending for approval", "error"); return; }
    transitionStage("E3-Approval", { frozen: true }, "Submit for approval", [[p.reviewer_id, "open_ef_reviews", -1], [p.approver_id, "open_ef_approvals", 1]]);
  });
  if (canAct) wireOnHoldCancel(el);
}

function renderE3(el) {
  const p = draft;
  const canAct = p.status === "E3-Approval";
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-head"><div><h2>EF Entry · E3 Approval<span class="tbd-tag">Details TBD w/ LCA team</span></h2><p>Approver gives business sign-off before Carbon App ingestion.</p></div></div>
    ${summaryRows(p)}
    <div class="actions">
      <button class="btn ghost danger" id="onHoldBtn" ${canAct ? "" : "disabled"}>Put On Hold</button>
      <button class="btn ghost danger" id="cancelBtn" ${canAct ? "" : "disabled"}>Cancel</button>
      <button class="btn ghost danger" id="returnReviewBtn" ${canAct ? "" : "disabled"}>Return for Review</button>
      <button class="btn primary" id="submitIngestionBtn" ${canAct ? "" : "disabled"}>Submit for Ingestion</button>
    </div>
  `;
  el.appendChild(card);
  document.getElementById("returnReviewBtn").addEventListener("click", () => transitionStage("E2-Review", { frozen: true }, "Return for review", [[p.approver_id, "open_ef_approvals", -1], [p.reviewer_id, "open_ef_reviews", 1]]));
  document.getElementById("submitIngestionBtn").addEventListener("click", () => transitionStage("E4-Ready", { frozen: true }, "Submit for ingestion", [[p.approver_id, "open_ef_approvals", -1]]));
  if (canAct) wireOnHoldCancel(el);
}

function renderE4(el) {
  const p = draft;
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-head"><div><h2>EF Entry · E4 Ready<span class="tbd-tag">To confirm w/ LCA team</span></h2><p>Ready for manual ingestion into the Carbon App. Ingestion itself happens outside this tool for now.</p></div></div>
    ${summaryRows(p)}
    <div class="actions"><button class="btn" id="markIngestedBtn">Mark as ingested (log only)</button>
    <button class="btn ghost danger" id="onHoldBtn">Put On Hold</button>
    <button class="btn ghost danger" id="cancelBtn">Cancel</button></div>
  `;
  el.appendChild(card);
  document.getElementById("markIngestedBtn").addEventListener("click", async () => {
    await logAudit("Marked as ingested", "ef_proposal", p.change_id, null, { ingested_at: new Date().toISOString() });
    toast(`${p.change_id} marked as ingested (audit log only, status unchanged)`, "success");
  });
  wireOnHoldCancel(el);
}

function renderE5(el) {
  const p = draft;
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-head"><div><h2>EF Entry · E5 On Hold</h2><p>Retained and viewable. Put back into ${p.on_hold_from_status || "its previous stage"} when ready to resume.</p></div></div>
    ${summaryRows(p)}
    <div class="actions"><button class="btn primary" id="resumeBtn">Resume ${p.on_hold_from_status || "previous stage"}</button></div>
  `;
  el.appendChild(card);
  document.getElementById("resumeBtn").addEventListener("click", () => transitionStage(p.on_hold_from_status || "E1-Draft", { on_hold_from_status: null }, "Resume from On Hold"));
}

function renderE6(el) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<div class="card-head"><div><h2>EF Entry · E6 Cancelled</h2><p>View-only. Cancellation cannot be undone.</p></div></div>${summaryRows(draft)}`;
  el.appendChild(card);
}

function wireOnHoldCancel(el) {
  document.getElementById("onHoldBtn")?.addEventListener("click", () => {
    transitionStage("E5-OnHold", { on_hold_from_status: draft.status }, "Put on hold");
  });
  document.getElementById("cancelBtn")?.addEventListener("click", () => {
    const p = draft;
    const adjustments = p.status === "E2-Review" ? [[p.reviewer_id, "open_ef_reviews", -1]]
      : p.status === "E3-Approval" ? [[p.approver_id, "open_ef_approvals", -1]]
      : [];
    showConfirmModal(
      "Cancel this EF proposal?",
      "This cannot be undone. The proposal will remain visible in the EF Log as Cancelled.",
      () => transitionStage("E6-Cancelled", { frozen: true }, "Cancel proposal", adjustments)
    );
  });
}

async function transitionStage(newStatus, patch, actionLabel, countAdjustments = []) {
  const p = draft;
  const oldStatus = p.status;
  const updated = { status: newStatus, ...patch };
  try {
    await updateRow("ef_proposals", "change_id", p.change_id, updated);
    Object.assign(p, updated);
    for (const [userId, field, delta] of countAdjustments) await adjustUserCount(userId, field, delta);
    const priorVersions = store.efProposalVersions.filter((v) => v.change_id === p.change_id).length;
    await insertRow("ef_proposal_versions", { change_id: p.change_id, version_no: priorVersions + 1, stage: newStatus, snapshot: { ...p, ...updated }, changed_by: store.currentUserId });
    await logAudit(actionLabel, "ef_proposal", p.change_id, { status: oldStatus }, { status: newStatus });
    const notifyTargets = [p.proposer_id, p.reviewer_id, p.approver_id].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const uid of notifyTargets) await notify(uid, `${p.change_id} moved from ${oldStatus} to ${newStatus} (${actionLabel})`, p.change_id);
    toast(`${p.change_id}: ${actionLabel}`, "success");
    await loadTransactionalData();
    activeStageView = newStatus;
    renderAll();
  } catch (e) { console.error(e); }
}

function showConfirmModal(title, body, onConfirm) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop"><div class="modal">
      <div class="modal-head"><h3>${title}</h3><button class="icon-btn" id="modalClose">✕</button></div>
      <p>${body}</p>
      <div class="actions"><button class="btn" id="modalCancel">Keep proposal</button><button class="btn primary" id="modalConfirm">Confirm</button></div>
    </div></div>`;
  const close = () => { root.innerHTML = ""; };
  document.getElementById("modalClose").addEventListener("click", close);
  document.getElementById("modalCancel").addEventListener("click", close);
  document.getElementById("modalConfirm").addEventListener("click", () => { close(); onConfirm(); });
}
