import { store, currentUser, insertRow, updateRow, logAudit, notify, loadTransactionalData, adjustUserCount, maybeInsertVersion, stableStringify, uploadEvidenceFile, deleteEvidenceFile, evidencePublicUrl } from "../dataStore.js";
import { createFacetFilterGroup } from "../facetFilter.js";
import { createStyledDropdown } from "../styledDropdown.js";
import { infoIcon, wireScrollTableTooltips } from "../tooltip.js";
import { goToPage } from "../nav.js";
import { toast } from "../toast.js";
import {
  STAGES, EF_TYPES, REVIEW_STEPS, generateChangeId, lookupCurrentEf, pctChange, yearlyEmissionsBaseline,
  productForMaterial, reviewRouteForAssurance, pickReviewer, pickApprover, deriveEfName,
  reviewGatingMessage, approvalGatingMessage, resolveCurrentEfTier,
} from "../efLogic.js";

let draft = null; // in-memory proposal being edited/viewed
let activeStageView = "E1-Draft";
let facetGroup = null;
let sourceDropdown = null, methodDropdown = null, assuranceDropdown = null;

function esmaOptions(category) {
  return store.efSourcesMethodsAssurance.filter((r) => r.category === category);
}

function blankDraft() {
  const d = {
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
    common_fields: { source: "", methodology: "", assurance: "", evidence: [], comment: "" },
    derived: {},
    review_steps: REVIEW_STEPS.map((s) => ({ text: s, done: false })),
    approval_notes: "",
    _isNew: true,
  };
  d._lastSaved = snapshotForDirtyCheck(d);
  return d;
}

// Strips null/""/[]/{} "empty" values recursively so a truly-blank draft
// compares equal regardless of whether it's been through a render pass yet -
// e.g. fields:{} (fresh) and fields:{facets:{gplt:[],material_code:[],...}}
// (after the facet group's first getSelections() call populates empty
// arrays for every key) must be treated as the same "nothing entered" state,
// not a false-positive unsaved change.
function stripEmpty(value) {
  if (Array.isArray(value)) {
    const arr = value.map(stripEmpty).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      const v = stripEmpty(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null || value === "" ? undefined : value;
}

function snapshotForDirtyCheck(d) {
  return stableStringify(stripEmpty({ ef_type: d.ef_type, fields: d.fields, common_fields: d.common_fields }) || {});
}

// Whether the current E1-Draft form has changes not yet persisted via Save
// Draft / Submit for Review - used to warn before navigating away or
// discarding it. Frozen/later-stage proposals are never "dirty" in this sense.
export function hasUnsavedChanges() {
  if (!draft || draft.frozen || draft.status !== "E1-Draft") return false;
  return snapshotForDirtyCheck(draft) !== draft._lastSaved;
}

// Runs onProceed immediately if there's nothing to lose; otherwise asks the
// user to save, discard, or stay, and only calls onProceed once resolved.
export function confirmDiscardIfDirty(onProceed) {
  if (!hasUnsavedChanges()) { onProceed(); return; }
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop"><div class="modal">
      <div class="modal-head"><h3>Unsaved changes</h3><button class="icon-btn" id="unsavedClose">✕</button></div>
      <p>This EF proposal draft has changes that haven't been saved. Leaving now will lose them.</p>
      <div class="actions">
        <button class="btn" id="unsavedCancel">Stay here</button>
        <button class="btn ghost danger" id="unsavedDiscard">Discard changes</button>
        <button class="btn primary" id="unsavedSave">Save draft & continue</button>
      </div>
    </div></div>`;
  const close = () => { root.innerHTML = ""; };
  document.getElementById("unsavedClose").addEventListener("click", close);
  document.getElementById("unsavedCancel").addEventListener("click", close);
  document.getElementById("unsavedDiscard").addEventListener("click", () => { close(); onProceed(); });
  document.getElementById("unsavedSave").addEventListener("click", async () => {
    close();
    await saveDraft(false);
    onProceed();
  });
}

// Unguarded - only call this once you already know it's safe to discard
// whatever was there (e.g. from inside a confirmDiscardIfDirty callback).
export function forceBlankDraft() {
  draft = blankDraft();
  activeStageView = "E1-Draft";
  renderAll();
}

export function mountEfEntry() {
  document.getElementById("newEfBtn").addEventListener("click", () => confirmDiscardIfDirty(forceBlankDraft));
  document.getElementById("openChangeIdBtn").addEventListener("click", () => {
    const id = document.getElementById("openChangeIdInput").value.trim();
    confirmDiscardIfDirty(() => openByChangeId(id));
  });
  if (!draft) { draft = blankDraft(); }
  renderAll();
}

function openByChangeId(id) {
  const found = store.efProposals.find((p) => p.change_id.toLowerCase() === id.toLowerCase());
  if (!found) { toast(`No EF proposal found with Change ID "${id}"`, "error"); return; }
  draft = { ...found, _isNew: false, _lastSaved: snapshotForDirtyCheck(found) };
  activeStageView = draft.status;
  renderAll();
}

export function openProposalById(changeId, stage) {
  const found = store.efProposals.find((p) => p.change_id === changeId);
  if (!found) return;
  draft = { ...found, _isNew: false, _lastSaved: snapshotForDirtyCheck(found) };
  activeStageView = stage || draft.status;
  goToPage("ef-entry");
  renderAll();
}

function renderAll() {
  renderStageTracker();
  renderStageScreen();
}

// Re-renders whatever's currently shown, without changing which proposal or
// stage is being viewed - used when something outside EF Entry changes that
// affects it (e.g. switching the "acting as" user/role, which changes
// whether the current viewer can act on the open proposal's E2/E3 screen).
export function rerenderIfMounted() {
  if (draft) renderAll();
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
  if (draft.status === "E1-Draft" && draft.derived?.lastReturnComment) {
    card.innerHTML += `<div class="notice warn"><strong>Returned for revision:</strong> ${draft.derived.lastReturnComment}</div>`;
  }

  const topRow = document.createElement("div");
  topRow.className = "ef1-top-row";

  const formCol = document.createElement("div");
  formCol.className = "ef1-form-col";
  formCol.innerHTML = `
    <div class="field" style="max-width:360px;margin-bottom:16px">
      <label>EF Type <span class="req">*</span></label>
      <select id="efTypeSelect" ${frozen ? "disabled" : ""}>
        ${EF_TYPES.map((t) => `<option value="${t}" ${t === draft.ef_type ? "selected" : ""}>${t}</option>`).join("")}
      </select>
    </div>
    <div id="typeSpecificArea"></div>
    <div id="alwaysFieldsArea"></div>
  `;

  const sideCol = document.createElement("div");
  sideCol.className = "ef1-side-col";
  sideCol.innerHTML = `
    <div class="card" id="derivedCard"><h3>Derived info</h3><div id="derivedRows"></div></div>
    <div class="card summary-panel" id="summaryCard"><h3>Historical Impact - Summary</h3><div id="summaryRows"></div></div>
  `;

  topRow.appendChild(formCol);
  topRow.appendChild(sideCol);
  card.appendChild(topRow);
  el.appendChild(card);

  const impactCard = document.createElement("div");
  impactCard.className = "card";
  impactCard.id = "impactCard";
  impactCard.innerHTML = `<h3>Reference data & impact</h3><div id="impactArea"></div>`;
  el.appendChild(impactCard);

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `
    <button class="btn ghost danger" id="clearBtn" ${frozen ? "disabled" : ""}>Clear form</button>
    <button class="btn" id="saveDraftBtn" ${frozen ? "disabled" : ""}>Save draft</button>
    <button class="btn primary" id="submitReviewBtn" ${frozen ? "disabled" : ""}>Submit for review</button>
  `;
  el.appendChild(actions);

  document.getElementById("efTypeSelect").addEventListener("change", (e) => {
    draft.ef_type = e.target.value;
    draft.fields = {};
    renderTypeSpecific();
  });
  // Always-fields must render BEFORE type-specific, since type-specific's
  // first updateDerivedAndImpact() call reads the always-fields' current DOM
  // values via readFormIntoDraft() - rendering them after would read from
  // not-yet-existing elements and silently wipe a reopened draft's
  // Source/Methodology/Assurance/Evidence/Comment back to blank.
  renderAlwaysFields();
  renderTypeSpecific();

  document.getElementById("clearBtn").addEventListener("click", () => confirmDiscardIfDirty(forceBlankDraft));
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

    if (draft.ef_type === "Material Specific EF") {
      // Product Name isn't a column on carbon_app_export itself yet (the real
      // export is expected to carry it natively eventually) - joined in here
      // from the Product Mapping table so it can participate as a facet like
      // every other box, via the same cross-facet pruning mechanism.
      const rowsWithProduct = store.carbonAppExport.map((r) => ({ ...r, product_name: productForMaterial(r.material_code) || "—" }));
      facetGroup = createFacetFilterGroup({
        container: facetContainer,
        rows: rowsWithProduct,
        facets: [
          { key: "gplt", label: "GPLT" },
          { key: "gplt1", label: "GPLT1" },
          { key: "gplt2", label: "GPLT2" },
          { key: "parent_supplier_name", label: "Parent Supplier Name" },
          { key: "supplier_name", label: "Supplier Name" },
          { key: "material", label: "Material" },
          { key: "material_code", label: "Material Code", required: true },
          { key: "product_name", label: "Product Name" },
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
    if (frozen) area.querySelectorAll("input,select,button").forEach((n) => (n.disabled = true));
    updateDerivedAndImpact();
  }

  function renderAlwaysFields() {
    const area = document.getElementById("alwaysFieldsArea");
    // isArrayShape guards the Remove button/index wiring below - only
    // meaningful once evidence is genuinely the current array shape; a
    // legacy (pre-round-4) proposal's evidence can only be viewed here, not
    // edited, and it's always frozen anyway when it's in a legacy shape.
    const rawEvidence = draft.common_fields.evidence;
    const isArrayShape = Array.isArray(rawEvidence);
    const evList = normalizeEvidenceList(rawEvidence);
    area.innerHTML = `
      <div class="section-title"><h4>Source, methodology & evidence</h4></div>
      <div class="field-grid">
        <div class="field"><label>Source of new EF <span class="req">*</span></label><div id="sourceDropdownMount"></div></div>
        <div class="field"><label>Methodology standard <span class="req">*</span></label><div id="methodDropdownMount"></div></div>
        <div class="field"><label>Assurance <span class="req">*</span></label><div id="assuranceDropdownMount"></div></div>
        <div class="field span-2">
          <label>Evidence files <span class="req">*</span>${infoIcon("Small demo-purpose files only (screenshot or short PDF), up to 5MB each, stored in Supabase Storage. Multiple files can be attached.")}</label>
          <div class="evidence-upload">
            ${evList.length ? `<ul class="evidence-list">${evList.map((ev, i) => `
              <li>
                <span class="evidence-current">📎 ${ev.filename}</span>
                <a class="btn ghost small" href="${ev.url}" target="_blank" rel="noopener">View</a>
                ${isArrayShape ? `<button type="button" class="btn ghost small danger" data-remove-evidence="${i}" ${frozen ? "disabled" : ""}>Remove</button>` : ""}
              </li>`).join("")}</ul>` : `<span class="evidence-current empty">No files uploaded yet</span>`}
            <input type="file" id="evidenceInput" accept="image/*,.pdf" ${frozen ? "disabled" : ""}>
          </div>
        </div>
        <div class="field span-2"><label>Proposer comment</label><textarea id="commentInput">${draft.common_fields.comment || ""}</textarea></div>
      </div>
    `;

    sourceDropdown?.destroy();
    methodDropdown?.destroy();
    assuranceDropdown?.destroy();

    const toOptions = (category) => esmaOptions(category).map((o) => ({ value: o.option_label, label: o.option_label, description: o.includes_text }));

    sourceDropdown = createStyledDropdown({
      container: document.getElementById("sourceDropdownMount"),
      options: toOptions("EF Source"), value: draft.common_fields.source, placeholder: "Select source",
      required: true, disabled: frozen, onChange: () => updateDerivedAndImpact(),
    });
    methodDropdown = createStyledDropdown({
      container: document.getElementById("methodDropdownMount"),
      options: toOptions("EF Methodology"), value: draft.common_fields.methodology, placeholder: "Select methodology",
      required: true, disabled: frozen, onChange: () => updateDerivedAndImpact(),
    });
    assuranceDropdown = createStyledDropdown({
      container: document.getElementById("assuranceDropdownMount"),
      options: toOptions("EF Assurance"), value: draft.common_fields.assurance, placeholder: "Select assurance",
      required: true, disabled: frozen, onChange: () => updateDerivedAndImpact(),
    });

    document.getElementById("commentInput").addEventListener("input", () => updateDerivedAndImpact());

    const evidenceInput = document.getElementById("evidenceInput");
    evidenceInput.addEventListener("change", async () => {
      const file = evidenceInput.files[0];
      if (!file) return;
      try {
        const uploaded = await uploadEvidenceFile(draft.change_id || (draft._tempEvidenceId ??= `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`), file);
        // A proposal returned for revision could still carry a legacy
        // (pre-round-4, non-array) evidence value - start fresh with the
        // current array format rather than trying to merge into it; the
        // legacy value is still visible in its old version-history snapshots.
        const existing = Array.isArray(draft.common_fields.evidence) ? draft.common_fields.evidence : [];
        draft.common_fields.evidence = [...existing, uploaded];
        toast(`Uploaded ${uploaded.filename}`, "success");
      } catch (e) {
        console.error(e);
        toast(e.message || "Evidence upload failed", "error");
      }
      renderAlwaysFields();
      updateDerivedAndImpact();
    });
    area.querySelectorAll("[data-remove-evidence]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.removeEvidence);
        const removed = draft.common_fields.evidence[idx];
        draft.common_fields.evidence = draft.common_fields.evidence.filter((_, i) => i !== idx);
        if (removed) deleteEvidenceFile(removed.path);
        renderAlwaysFields();
        updateDerivedAndImpact();
      });
    });

    if (frozen) area.querySelectorAll("input,textarea").forEach((n) => (n.disabled = true));
  }
}

function readFormIntoDraft() {
  const facets = facetGroup ? facetGroup.getSelections() : {};
  draft.fields.facets = facets;
  // Defensive: only overwrite a field when its control actually exists yet.
  // (Guards against the render-order class of bug even if it recurs later -
  // reading a not-yet-rendered field should leave the stored value alone,
  // never silently blank it out.)
  const el = (id) => document.getElementById(id);
  const val = (id) => el(id)?.value;
  if (el("newEfValue")) draft.fields.newEfValue = val("newEfValue") ? Number(val("newEfValue")) : null;
  if (el("newEfUnit")) draft.fields.newEfUnit = val("newEfUnit") || null;
  if (el("unitMass")) draft.fields.unitMass = val("unitMass") ? Number(val("unitMass")) : null;
  if (sourceDropdown) draft.common_fields.source = sourceDropdown.getValue() || "";
  if (methodDropdown) draft.common_fields.methodology = methodDropdown.getValue() || "";
  if (assuranceDropdown) draft.common_fields.assurance = assuranceDropdown.getValue() || "";
  if (el("commentInput")) draft.common_fields.comment = val("commentInput") || "";
}

function updateDerivedAndImpact() {
  readFormIntoDraft();
  const matchingRows = facetGroup ? facetGroup.getMatchingRows() : [];
  const facets = draft.fields.facets || {};

  let materialCodes = [];
  let supplierNumber = null;
  let commonId1s = [];
  let classifications = [];

  if (draft.ef_type === "Material Specific EF") {
    materialCodes = facets.material_code || [];
  } else if (draft.ef_type === "Supplier Spend EF / CCF index") {
    supplierNumber = (facets.supplier_number || [])[0] || null;
  } else if (draft.ef_type === "Global EF - Material to Common ID mapping") {
    commonId1s = facets.common_id1 || [];
  } else {
    classifications = facets.enriched_l1l2l3_classification || [];
  }

  // Only recompute-and-overwrite the auto-assignment preview while the
  // proposal is genuinely editable. Recomputing this against LIVE workload
  // counts/current-user for an already-submitted (frozen) proposal was a
  // real bug: simply viewing its E1 tab could silently show a different
  // reviewer/approver/proposer than who was actually assigned, since the
  // "fewest open reviews" comparison shifts over time (including as a side
  // effect of the proposal's own real assignment). When frozen, draft.derived
  // already holds the correct persisted values - displayed read-only below.
  if (!draft.frozen) {
    const route = reviewRouteForAssurance(draft.common_fields.assurance);
    const reviewer = route ? pickReviewer(route) : null;
    const approver = pickApprover();
    // Proposer locks at first submission (proposer_id becomes non-null) and
    // must display as that locked person from then on, even while genuinely
    // editable again after a Return for Revision - otherwise reopening a
    // returned draft as a different acting-as user would show THAT user as
    // proposer, defeating the lock. Only a truly new, never-submitted draft
    // (proposer_id still null) previews whoever is currently editing.
    const proposer = draft.proposer_id
      ? store.users.find((u) => u.user_id === draft.proposer_id) || null
      : currentUser();

    let efName = "";
    let productBrand = "—";
    if (draft.ef_type === "Material Specific EF" && materialCodes.length) {
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
  }

  document.getElementById("derivedRows").innerHTML = `
    ${derivedRow("Project ID", "Non-project (no linked project)")}
    ${derivedRow("Change ID", draft.derived.changeId)}
    ${derivedRow(`New EF Name<span class="tbd-tag subtle">Naming standard TBD</span>`, draft.derived.newEfName)}
    ${derivedRow("Proposed Review Route" + infoIcon("Independently verified/reviewed/customer-reviewed assurance levels route to a Standard Reviewer; unverified levels route to an Expert Reviewer, per the EF Sources/Methods/Assurance reference table."), draft.derived.reviewRoute)}
    ${derivedRow("Reviewer (auto-assigned)" + infoIcon("The eligible reviewer (matching role and route) with the fewest current open reviews. Ties break alphabetically by name."), draft.derived.reviewerName)}
    ${derivedRow("Approver (auto-assigned)" + infoIcon("The EF Approver with the fewest current open approvals. Ties break alphabetically by name."), draft.derived.approverName)}
    ${derivedRow("Change Proposer", draft.derived.proposerName)}
    ${derivedRow("Linked Product", draft.derived.productBrand)}
  `;

  renderImpact({ materialCodes, supplierNumber, commonId1s, classifications, matchingRows });
  renderSummaryPanel({ materialCodes, supplierNumber, commonId1s, classifications, matchingRows });

  const submitBtn = document.getElementById("submitReviewBtn");
  if (submitBtn) submitBtn.disabled = draft.frozen || validateMandatory().length > 0;
}

function derivedRow(k, v) {
  return `<div class="derived-row"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

function isBlank(v) {
  return v === null || v === undefined || v === "";
}

// Converts the proposed New EF Value into kg CO2e/kg, the one basis that can
// be multiplied by tonnage regardless of which unit the proposer picked.
// Unit Mass (kg per unit) is what makes the "per unit" case convertible at
// all - it's collected for exactly this purpose.
function newEfPerKg(newVal, newEfUnit, unitMass) {
  if (newVal === null || newVal === undefined || isNaN(newVal)) return null;
  if (newEfUnit === "kg CO2e / kg") return newVal;
  if (newEfUnit === "kg CO2e / tonne") return newVal / 1000;
  if (newEfUnit === "kg CO2e / unit") return unitMass ? newVal / unitMass : null;
  return null;
}

// Shared per-material computation used by both the impact table and the
// high-level summary panel, so the two never drift apart.
//
// Current EF: trusted directly from Carbon App Export's own co2_factor_final
// / co2e_mt (never recomputed via the cascade - see resolveCurrentEfTier).
// The delta only needs to convert the NEW side (fully controlled - the
// proposer picks its unit and supplies Unit Mass); the current side uses
// co2e_mt as-is, sidestepping the need to know the current EF's own unit.
// When a material's current tier is spend-based, Carbon App Export never
// recorded a tonnage for it, so the estimate is genuinely not possible -
// not just "not yet computed" - and is surfaced as such rather than as a
// silent zero or dash.
function computeMaterialImpactRows(materialCodes, newVal, newEfUnit, unitMass) {
  const newPerKg = newEfPerKg(newVal, newEfUnit, unitMass);
  return materialCodes.map((mc) => {
    const caeRows = store.carbonAppExport.filter((r) => r.material_code === mc).sort((a, b) => a.year - b.year);
    const latest = caeRows[caeRows.length - 1] || null;
    const previous = caeRows.length > 1 ? caeRows[caeRows.length - 2] : null;
    const currentTier = latest ? resolveCurrentEfTier(latest.co2_factor_name_final) : null;

    const tonnageYtdOk = !!(latest && !isBlank(latest.tonnage));
    const tonnagePrevOk = !!(previous && !isBlank(previous.tonnage));

    const baselineYtd = latest ? yearlyEmissionsBaseline(latest.year) : 0;
    const baselinePrev = previous ? yearlyEmissionsBaseline(previous.year) : 0;

    const deltaYtd = tonnageYtdOk && newPerKg !== null ? (newPerKg * Number(latest.tonnage)) - Number(latest.co2e_mt || 0) : null;
    const deltaPrev = tonnagePrevOk && newPerKg !== null ? (newPerKg * Number(previous.tonnage)) - Number(previous.co2e_mt || 0) : null;
    const pctChangeYtd = deltaYtd !== null && baselineYtd ? (deltaYtd / baselineYtd) * 100 : null;
    const pctChangePrev = deltaPrev !== null && baselinePrev ? (deltaPrev / baselinePrev) * 100 : null;

    return { mc, latest, previous, currentTier, deltaYtd, deltaPrev, pctChangeYtd, pctChangePrev, tonnageYtdOk, tonnagePrevOk };
  });
}

function fmtNum(v, suffix = "") {
  return v === null || v === undefined || isNaN(v) ? "—" : `${Number(v).toFixed(2)}${suffix}`;
}

function renderImpact({ materialCodes, supplierNumber, commonId1s, classifications, matchingRows }) {
  const area = document.getElementById("impactArea");
  const newVal = draft.fields.newEfValue;

  if (draft.ef_type === "Material Specific EF") {
    if (!materialCodes.length) { area.innerHTML = `<p class="empty">Select at least one Material Code.</p>`; return; }
    const rows = computeMaterialImpactRows(materialCodes, newVal, draft.fields.newEfUnit, draft.fields.unitMass);
    const totals = rows.reduce((acc, r) => {
      acc.tonnageYtd += r.tonnageYtdOk ? Number(r.latest.tonnage) : 0;
      acc.tonnagePrev += r.tonnagePrevOk ? Number(r.previous.tonnage) : 0;
      acc.invQtyYtd += Number(r.latest?.invoice_quantity || 0);
      acc.invQtyPrev += Number(r.previous?.invoice_quantity || 0);
      acc.emissionsYtd += Number(r.latest?.co2e_mt || 0);
      acc.emissionsPrev += Number(r.previous?.co2e_mt || 0);
      acc.pctYtd += r.pctChangeYtd || 0;
      acc.pctPrev += r.pctChangePrev || 0;
      return acc;
    }, { tonnageYtd: 0, tonnagePrev: 0, invQtyYtd: 0, invQtyPrev: 0, emissionsYtd: 0, emissionsPrev: 0, pctYtd: 0, pctPrev: 0 });

    const naCell = (why) => `<span class="cell-na" tabindex="0" data-tooltip="${why}">n/a</span>`;
    const spendReason = "Cannot estimate - this material's Current EF is spend-based, so Carbon App Export has no tonnage recorded for it.";

    const rowsHtml = rows.map(({ mc, latest, previous, currentTier, pctChangeYtd, pctChangePrev, tonnageYtdOk, tonnagePrevOk }) => `
      <tr>
        <td>${mc}</td>
        <td>${latest?.indicator_name || latest?.material || "—"}</td>
        <td>${latest?.uom || "—"}</td>
        <td>${latest?.co2_factor_name_final || "None found"}</td>
        <td>${currentTier ? currentTier.tier : "—"}</td>
        <td>${currentTier?.unit || "—"}</td>
        <td>${latest ? fmtNum(Number(latest.co2_factor_final)) : "—"}</td>
        <td>${tonnageYtdOk ? fmtNum(latest.tonnage) : naCell(spendReason)}</td>
        <td>${previous ? (tonnagePrevOk ? fmtNum(previous.tonnage) : naCell(spendReason)) : "—"}</td>
        <td>${tonnageYtdOk ? fmtNum(latest.invoice_quantity) : naCell(spendReason)}</td>
        <td>${previous ? (tonnagePrevOk ? fmtNum(previous.invoice_quantity) : naCell(spendReason)) : "—"}</td>
        <td>${fmtNum(latest?.co2e_mt, "t")}</td>
        <td>${fmtNum(previous?.co2e_mt, "t")}</td>
        <td>${tonnageYtdOk ? (pctChangeYtd !== null ? pctChangeYtd.toFixed(3) + "%" : "—") : naCell(spendReason)}</td>
        <td>${previous ? (tonnagePrevOk ? (pctChangePrev !== null ? pctChangePrev.toFixed(3) + "%" : "—") : naCell(spendReason)) : "—"}</td>
      </tr>`).join("");

    area.innerHTML = `<div class="table-scroll"><table>
      <thead><tr>
        <th>Material Code</th><th>Indicator</th><th>UoM</th><th>Current EF Name</th>
        <th>Current EF Type${infoIcon("Identified by matching this row's Current EF Name against each reference table's own name column - the value itself is trusted directly from Carbon App Export, never recomputed.")}</th>
        <th>Current EF Unit</th><th>Current EF Value</th><th>Tonnage YTD</th><th>Tonnage Prev. Yr</th><th>Invoice Qty YTD</th><th>Invoice Qty Prev. Yr</th>
        <th>YTD Emissions</th><th>Last Yr Emissions</th>
        <th>% Change YTD${infoIcon("New EF value (converted to kg CO2e/kg via New EF Unit + Unit Mass) × YTD tonnage, minus this year's already-resolved YTD Emissions - expressed as a % of total Scope 3-1a emissions for that year. Shown as n/a when this material's Current EF is spend-based, since there is no tonnage to estimate from.")}</th>
        <th>% Change Last Yr${infoIcon("Same calculation using last year's tonnage, last year's emissions and last year's Scope 3-1a total as the baseline.")}</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr>
        <td colspan="7"><strong>Total</strong></td>
        <td>${fmtNum(totals.tonnageYtd)}</td><td>${fmtNum(totals.tonnagePrev)}</td>
        <td>${fmtNum(totals.invQtyYtd)}</td><td>${fmtNum(totals.invQtyPrev)}</td>
        <td>${fmtNum(totals.emissionsYtd, "t")}</td><td>${fmtNum(totals.emissionsPrev, "t")}</td>
        <td>${totals.pctYtd.toFixed(3)}%</td><td>${totals.pctPrev.toFixed(3)}%</td>
      </tr></tfoot>
    </table></div>`;
    wireScrollTableTooltips(area);
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

function directionBadge(delta) {
  if (delta === null || delta === undefined || isNaN(delta) || Math.abs(delta) < 0.0005) return `<span class="direction-badge flat">No change</span>`;
  return delta > 0 ? `<span class="direction-badge increase">↑ Increase</span>` : `<span class="direction-badge decrease">↓ Decrease</span>`;
}

function metricRow(label, valueHtml) {
  return `<div class="metric-row"><span class="metric-label">${label}</span><span class="metric-value">${valueHtml}</span></div>`;
}

const ILLUSTRATIVE_NOTE = "Illustrative figure only: uses that year's recorded tonnage as a stand-in for scale, since an approved EF only actually applies to future emissions. Gives a sense of potential future impact, not a precise forecast.";
const SHARE_NOTE = "Illustrative figure only, same tonnage basis as the ΔCO2e figure above: expressed as a % of total Scope 3-1a emissions for that year.";

function renderSummaryPanel({ materialCodes, supplierNumber, commonId1s, classifications }) {
  const area = document.getElementById("summaryRows");
  const newVal = draft.fields.newEfValue;

  if (draft.ef_type === "Material Specific EF") {
    if (!materialCodes.length) { area.innerHTML = `<p class="empty">Select at least one Material Code to see the impact summary.</p>`; return; }
    const rows = computeMaterialImpactRows(materialCodes, newVal, draft.fields.newEfUnit, draft.fields.unitMass);
    const inputsComplete = newEfPerKg(newVal, draft.fields.newEfUnit, draft.fields.unitMass) !== null;

    const totalDeltaYtd = rows.reduce((s, r) => s + (r.deltaYtd || 0), 0);
    const totalDeltaPrev = rows.reduce((s, r) => s + (r.deltaPrev || 0), 0);
    const anyYtd = inputsComplete && rows.some((r) => r.deltaYtd !== null);
    const anyPrev = inputsComplete && rows.some((r) => r.deltaPrev !== null);

    const yearsYtd = new Set(rows.filter((r) => r.latest).map((r) => r.latest.year));
    const yearsPrev = new Set(rows.filter((r) => r.previous).map((r) => r.previous.year));
    const baselineYtd = [...yearsYtd].reduce((s, y) => s + yearlyEmissionsBaseline(y), 0);
    const baselinePrev = [...yearsPrev].reduce((s, y) => s + yearlyEmissionsBaseline(y), 0);
    const shareYtd = anyYtd && baselineYtd ? (totalDeltaYtd / baselineYtd) * 100 : null;
    const sharePrev = anyPrev && baselinePrev ? (totalDeltaPrev / baselinePrev) * 100 : null;

    const cell = (has, val) => (!inputsComplete ? "—" : has ? val : "n/a");

    area.innerHTML = [
      metricRow("Material Codes impacted", materialCodes.length),
      metricRow("Direction · YTD", inputsComplete && anyYtd ? directionBadge(totalDeltaYtd) : `<span class="direction-badge flat">—</span>`),
      metricRow(`ΔCO2e impact · YTD${infoIcon(ILLUSTRATIVE_NOTE)}`, cell(anyYtd, fmtNum(totalDeltaYtd, "t"))),
      metricRow(`Share of Scope 3-1a · YTD${infoIcon(SHARE_NOTE)}`, cell(anyYtd, shareYtd !== null ? shareYtd.toFixed(3) + "%" : "n/a")),
      metricRow("Direction · Last Yr", inputsComplete && anyPrev ? directionBadge(totalDeltaPrev) : `<span class="direction-badge flat">—</span>`),
      metricRow(`ΔCO2e impact · Last Yr${infoIcon(ILLUSTRATIVE_NOTE)}`, cell(anyPrev, fmtNum(totalDeltaPrev, "t"))),
      metricRow(`Share of Scope 3-1a · Last Yr${infoIcon(SHARE_NOTE)}`, cell(anyPrev, sharePrev !== null ? sharePrev.toFixed(3) + "%" : "n/a")),
    ].join("");
  } else if (draft.ef_type === "Supplier Spend EF / CCF index") {
    if (!supplierNumber) { area.innerHTML = `<p class="empty">Select a supplier to see the impact summary.</p>`; return; }
    const current = lookupCurrentEf({ supplierNumber });
    const change = current && newVal != null ? pctChange(current.value, newVal) : null;
    area.innerHTML = [
      metricRow("Suppliers impacted", 1),
      metricRow("Direction", change !== null ? directionBadge(change) : `<span class="direction-badge flat">—</span>`),
      metricRow(`Total ΔCO2e impact${infoIcon("Not available for this EF type - spend-based factors have no tonnage basis to compute an emissions figure from.")}`, `<span class="metric-value small">n/a</span>`),
    ].join("");
  } else if (draft.ef_type === "Global EF - Material to Common ID mapping") {
    if (!commonId1s.length) { area.innerHTML = `<p class="empty">Select a Common ID1 to see the impact summary.</p>`; return; }
    const cid = commonId1s[0];
    const gfi = store.globalFactorsInventory.find((r) => r.common_id1 === cid);
    const change = gfi && newVal != null ? pctChange(Number(gfi.co2_emission_factor_current), newVal) : null;
    const linkedCount = store.commonId.filter((r) => r.common_id1 === cid).length;
    area.innerHTML = [
      metricRow("Material IDs impacted", linkedCount),
      metricRow("Direction", change !== null ? directionBadge(change) : `<span class="direction-badge flat">—</span>`),
      metricRow(`Total ΔCO2e impact${infoIcon("Not available for this EF type - Common ID mappings have no per-material tonnage basis in this reference data to compute an emissions figure from.")}`, `<span class="metric-value small">n/a</span>`),
    ].join("");
  } else {
    if (!classifications.length) { area.innerHTML = `<p class="empty">Select an EEIO classification to see the impact summary.</p>`; return; }
    const cls = classifications[0];
    const ef = store.eeioEf.find((r) => r.enriched_l1l2l3_classification === cls);
    const change = ef && newVal != null ? pctChange(Number(ef.eeio_factor_kgco2e_gbp), newVal) : null;
    const eeioRow = store.eeio.find((r) => r.enriched_l1l2l3_classification === cls);
    const linkedCount = eeioRow
      ? new Set(store.carbonAppExport.filter((r) =>
          r.category_level_1_enriched === eeioRow.category_level_1_enriched &&
          r.category_level_2_enriched === eeioRow.category_level_2_enriched &&
          r.category_level_3_enriched === eeioRow.category_level_3_enriched
        ).map((r) => r.material_code)).size
      : 0;
    area.innerHTML = [
      metricRow("Material Codes impacted", linkedCount),
      metricRow("Direction", change !== null ? directionBadge(change) : `<span class="direction-badge flat">—</span>`),
      metricRow(`Total ΔCO2e impact${infoIcon("Not available for this EF type - CEDA/EEIO factors have no per-material tonnage basis in this reference data to compute an emissions figure from.")}`, `<span class="metric-value small">n/a</span>`),
    ].join("");
  }
}

function validateMandatory() {
  const missing = [];
  const facets = draft.fields.facets || {};
  if (draft.ef_type === "Material Specific EF") {
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
  if (!(draft.common_fields.evidence || []).length) missing.push("Evidence file");
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
    // Locked at first submission, not re-set here - draft.proposer_id already
    // carries the original proposer forward across loads/reopens, so
    // "Return for Revision" always goes back to whoever actually proposed it,
    // never to whoever most recently clicked Save.
    proposer_id: draft.proposer_id,
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
      await maybeInsertVersion(draft.change_id, "E1-Draft", "Create draft", { ...payload, status: "E1-Draft", frozen: false });
      if (submitForReview) await logAudit("Submit for review", "ef_proposal", draft.change_id, { status: "E1-Draft" }, { status: "E2-Review" });
    } else {
      await updateRow("ef_proposals", "change_id", draft.change_id, payload);
      await logAudit(submitForReview ? "Submit for review" : "Save draft", "ef_proposal", draft.change_id, null, payload);
    }
    if (submitForReview) {
      await maybeInsertVersion(draft.change_id, "E2-Review", "Submit for review", payload);
      if (reviewer) {
        await adjustUserCount(reviewer.user_id, "open_ef_reviews", 1);
        await notify(reviewer.user_id, `You were assigned to review ${draft.change_id}`, draft.change_id);
      }
      toast(`${draft.change_id} submitted for review`, "success");
    } else {
      await maybeInsertVersion(draft.change_id, "E1-Draft", "Save draft", payload);
      toast(`${draft.change_id} saved as draft`, "success");
    }
    Object.assign(draft, payload);
    draft._isNew = false;
    draft._lastSaved = snapshotForDirtyCheck(draft);
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

// Defensive against legacy evidence shapes from before this round's
// multi-file rework: a plain URL string (pre-round-3, free-text link field),
// a single {path,filename} object (round-3, single-file), or the current
// array of {path,filename}. Always normalizes to an array of
// {filename, url} so rendering code only ever has one shape to handle.
function normalizeEvidenceList(evidence) {
  if (!evidence) return [];
  if (Array.isArray(evidence)) return evidence.map((ev) => ({ filename: ev.filename, url: ev.path ? evidencePublicUrl(ev.path) : ev.url }));
  if (typeof evidence === "string") return [{ filename: evidence, url: evidence }];
  if (typeof evidence === "object" && evidence.path) return [{ filename: evidence.filename, url: evidencePublicUrl(evidence.path) }];
  return [];
}

function summaryRows(p) {
  const facets = p.fields.facets || {};
  const rows = [
    ["Change ID", p.change_id], ["EF Type", p.ef_type], ["Status", p.status],
    ["New EF Value", p.fields.newEfValue], ["New EF Unit", p.fields.newEfUnit || "—"],
  ];
  Object.entries(facets).forEach(([k, v]) => rows.push([k, (v || []).join(", ") || "—"]));
  const evList = normalizeEvidenceList(p.common_fields.evidence);
  const evidenceHtml = evList.length
    ? evList.map((ev) => `<a href="${ev.url}" target="_blank" rel="noopener">📎 ${ev.filename}</a>`).join("<br>")
    : "—";
  rows.push(["Source", p.common_fields.source], ["Methodology", p.common_fields.methodology],
    ["Assurance", p.common_fields.assurance], ["Evidence", evidenceHtml],
    ["New EF Name", p.derived.newEfName], ["Reviewer", p.derived.reviewerName], ["Approver", p.derived.approverName],
    ["Proposer", p.derived.proposerName]);
  return rows.map(([k, v]) => derivedRow(k, v ?? "—")).join("");
}

function checklistPieSvg(doneCount, total) {
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const r = 34, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return `<svg width="88" height="88" viewBox="0 0 88 88">
    <circle cx="44" cy="44" r="${r}" fill="none" stroke="var(--gray-bg)" stroke-width="12"/>
    <circle cx="44" cy="44" r="${r}" fill="none" stroke="var(--primary)" stroke-width="12"
      stroke-dasharray="${dash.toFixed(1)} ${(circ - dash).toFixed(1)}" stroke-linecap="round" transform="rotate(-90 44 44)"/>
    <text x="44" y="49" text-anchor="middle" font-size="17" font-weight="700" fill="var(--text)">${pct}%</text>
  </svg>`;
}

function renderE2(el) {
  const p = draft;
  const card = document.createElement("div");
  card.className = "card";
  const atStage = p.status === "E2-Review";
  const gatingMsg = atStage ? reviewGatingMessage(p) : null;
  const canAct = atStage && !gatingMsg;
  const doneCount = () => (p.review_steps || []).filter((s) => s.done).length;
  const total = (p.review_steps || []).length;
  card.innerHTML = `
    <div class="card-head"><div><h2>EF Entry · E2 Review<span class="tbd-tag">Details TBD w/ LCA team</span></h2><p>Reviewer validates the proposal against EF Expert Guidance before it can move to Approval.</p></div></div>
    ${gatingMsg ? `<div class="notice warn">${gatingMsg} You can view this proposal but not act on it.</div>` : ""}
    ${p.status === "E2-Review" && p.derived?.lastReturnComment ? `<div class="notice warn"><strong>Returned for review:</strong> ${p.derived.lastReturnComment}</div>` : ""}
    <div class="grid two-col">
      <div>${summaryRows(p)}</div>
      <div>
        <h3>EF Expert Guidance checklist</h3>
        <div class="checklist-progress">
          <div id="checklistPie">${checklistPieSvg(doneCount(), total)}</div>
          <span class="caption" id="checklistCaption">${doneCount()} of ${total} steps complete</span>
        </div>
        <div class="checklist" id="checklist">
          ${(p.review_steps || []).map((s, i) => `<label><input type="checkbox" data-i="${i}" ${s.done ? "checked" : ""} ${canAct ? "" : "disabled"}> ${s.text}</label>`).join("")}
        </div>
      </div>
    </div>
    <div class="actions">
      <button class="btn ghost danger" id="onHoldBtn" ${canAct ? "" : "disabled"}>Put On Hold</button>
      <button class="btn ghost danger" id="cancelBtn" ${canAct ? "" : "disabled"}>Cancel</button>
      <button class="btn ghost danger" id="returnDraftBtn" ${canAct ? "" : "disabled"}>Return for Revision</button>
      <button class="btn primary" id="submitApprovalBtn" ${canAct && doneCount() === total ? "" : "disabled"}>Submit for Approval</button>
    </div>
  `;
  el.appendChild(card);
  card.querySelectorAll('#checklist input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      p.review_steps[Number(cb.dataset.i)].done = cb.checked;
      document.getElementById("checklistPie").innerHTML = checklistPieSvg(doneCount(), total);
      document.getElementById("checklistCaption").textContent = `${doneCount()} of ${total} steps complete`;
      document.getElementById("submitApprovalBtn").disabled = !(canAct && doneCount() === total);
    });
  });
  document.getElementById("returnDraftBtn").addEventListener("click", () => {
    showCommentModal(
      "Return for Revision?",
      "The proposer will need to address your comment before resubmitting.",
      (comment) => transitionStage(
        "E1-Draft",
        { frozen: false, derived: { ...p.derived, lastReturnComment: comment } },
        "Return for revision",
        [[p.reviewer_id, "open_ef_reviews", -1]]
      )
    );
  });
  document.getElementById("submitApprovalBtn").addEventListener("click", () => {
    if (!p.review_steps.every((s) => s.done)) { toast("Complete every checklist step before sending for approval", "error"); return; }
    transitionStage("E3-Approval", { frozen: true }, "Submit for approval", [[p.reviewer_id, "open_ef_reviews", -1], [p.approver_id, "open_ef_approvals", 1]]);
  });
  if (canAct) wireOnHoldCancel(el);
}

function renderE3(el) {
  const p = draft;
  const atStage = p.status === "E3-Approval";
  const gatingMsg = atStage ? approvalGatingMessage(p) : null;
  const canAct = atStage && !gatingMsg;
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card-head"><div><h2>EF Entry · E3 Approval<span class="tbd-tag">Details TBD w/ LCA team</span></h2><p>Approver gives business sign-off before Carbon App ingestion.</p></div></div>
    ${gatingMsg ? `<div class="notice warn">${gatingMsg} You can view this proposal but not act on it.</div>` : ""}
    ${summaryRows(p)}
    <div class="actions">
      <button class="btn ghost danger" id="onHoldBtn" ${canAct ? "" : "disabled"}>Put On Hold</button>
      <button class="btn ghost danger" id="cancelBtn" ${canAct ? "" : "disabled"}>Cancel</button>
      <button class="btn ghost danger" id="returnReviewBtn" ${canAct ? "" : "disabled"}>Return for Review</button>
      <button class="btn primary" id="submitIngestionBtn" ${canAct ? "" : "disabled"}>Submit for Ingestion</button>
    </div>
  `;
  el.appendChild(card);
  document.getElementById("returnReviewBtn").addEventListener("click", () => {
    showCommentModal(
      "Return for Review?",
      "The reviewer will need to address your comment before resubmitting for approval.",
      (comment) => transitionStage(
        "E2-Review",
        { frozen: true, derived: { ...p.derived, lastReturnComment: comment } },
        "Return for review",
        [[p.approver_id, "open_ef_approvals", -1], [p.reviewer_id, "open_ef_reviews", 1]]
      )
    );
  });
  document.getElementById("submitIngestionBtn").addEventListener("click", () => transitionStage("E4-Ready", { frozen: true }, "Submit for ingestion", [[p.approver_id, "open_ef_approvals", -1]]));
  if (canAct) wireOnHoldCancel(el);
}

function renderE4(el) {
  const p = draft;
  const card = document.createElement("div");
  card.className = "card";
  const ingestedBadge = p.ingested_at
    ? `<span class="ingested-badge">✓ Ingested on ${new Date(p.ingested_at).toLocaleDateString()}</span>`
    : "";
  card.innerHTML = `
    <div class="card-head"><div><h2>EF Entry · E4 Ready<span class="tbd-tag">To confirm w/ LCA team</span></h2><p>Ready for ingestion into the Carbon App. ${ingestedBadge}</p></div></div>
    ${summaryRows(p)}
    <div class="actions">
      <button class="btn primary" id="markIngestedBtn" ${p.ingested_at ? "disabled" : ""}>${p.ingested_at ? "Already marked as ingested" : "✓ Mark as ingested into Carbon App"}</button>
      <button class="btn ghost danger" id="onHoldBtn">Put On Hold</button>
      <button class="btn ghost danger" id="cancelBtn">Cancel</button>
    </div>
  `;
  el.appendChild(card);
  document.getElementById("markIngestedBtn").addEventListener("click", async () => {
    // ingested_at is the same field a future real Carbon App integration
    // would set automatically - a timestamp flag on the proposal itself,
    // not just an audit-log entry, so it can persist as a badge here and
    // show up in the EF Log / Dashboard.
    const ingestedAt = new Date().toISOString();
    try {
      await updateRow("ef_proposals", "change_id", p.change_id, { ingested_at: ingestedAt });
      p.ingested_at = ingestedAt;
      await logAudit("Marked as ingested", "ef_proposal", p.change_id, null, { ingested_at: ingestedAt });
      await loadTransactionalData();
      toast(`${p.change_id} marked as ingested`, "success");
      renderAll();
    } catch (e) { console.error(e); }
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
    <div class="actions">
      <button class="btn ghost danger" id="cancelBtn">Cancel</button>
      <button class="btn primary" id="resumeBtn">Resume ${p.on_hold_from_status || "previous stage"}</button>
    </div>
  `;
  el.appendChild(card);
  document.getElementById("resumeBtn").addEventListener("click", () => transitionStage(p.on_hold_from_status || "E1-Draft", { on_hold_from_status: null }, "Resume from On Hold"));
  document.getElementById("cancelBtn").addEventListener("click", () => {
    showConfirmModal(
      "Cancel this EF proposal?",
      "This cannot be undone. The proposal will remain visible in the EF Log as Cancelled.",
      () => transitionStage("E6-Cancelled", { frozen: true, on_hold_from_status: null }, "Cancel proposal", cancelAdjustments(p.on_hold_from_status))
    );
  });
}

function renderE6(el) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<div class="card-head"><div><h2>EF Entry · E6 Cancelled</h2><p>View-only. Cancellation cannot be undone.</p></div></div>${summaryRows(draft)}`;
  el.appendChild(card);
}

// Shared between the Cancel button (wherever it appears) and E5's own
// Cancel-from-On-Hold path, which needs to release workload based on the
// stage the proposal was paused FROM, not its current "E5-OnHold" status.
function cancelAdjustments(fromStatus) {
  const p = draft;
  return fromStatus === "E2-Review" ? [[p.reviewer_id, "open_ef_reviews", -1]]
    : fromStatus === "E3-Approval" ? [[p.approver_id, "open_ef_approvals", -1]]
    : [];
}

function wireOnHoldCancel(el) {
  document.getElementById("onHoldBtn")?.addEventListener("click", () => {
    showConfirmModal(
      "Put this EF proposal on hold?",
      "It will be retained and viewable, but paused out of the active workflow. You can resume it back into its current stage whenever you're ready.",
      () => transitionStage("E5-OnHold", { on_hold_from_status: draft.status }, "Put on hold")
    );
  });
  document.getElementById("cancelBtn")?.addEventListener("click", () => {
    const p = draft;
    showConfirmModal(
      "Cancel this EF proposal?",
      "This cannot be undone. The proposal will remain visible in the EF Log as Cancelled.",
      () => transitionStage("E6-Cancelled", { frozen: true }, "Cancel proposal", cancelAdjustments(p.status))
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
    await maybeInsertVersion(p.change_id, newStatus, actionLabel, { ...p, ...updated });
    await logAudit(actionLabel, "ef_proposal", p.change_id, { status: oldStatus }, { status: newStatus });
    const notifyTargets = [p.proposer_id, p.reviewer_id, p.approver_id].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const uid of notifyTargets) await notify(uid, `${p.change_id} moved from ${oldStatus} to ${newStatus} (${actionLabel})`, p.change_id);
    toast(`${p.change_id}: ${actionLabel}`, "success");
    await loadTransactionalData();
    activeStageView = newStatus;
    renderAll();
  } catch (e) { console.error(e); }
}

function showCommentModal(title, body, onConfirm) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop"><div class="modal">
      <div class="modal-head"><h3>${title}</h3><button class="icon-btn" id="modalClose">✕</button></div>
      <p>${body}</p>
      <div class="field"><label>Comment <span class="req">*</span></label><textarea id="returnCommentInput" placeholder="Explain what needs to change…"></textarea></div>
      <div class="actions"><button class="btn" id="modalCancel">Keep proposal</button><button class="btn primary" id="modalConfirm" disabled>Confirm</button></div>
    </div></div>`;
  const close = () => { root.innerHTML = ""; };
  const textarea = document.getElementById("returnCommentInput");
  const confirmBtn = document.getElementById("modalConfirm");
  textarea.addEventListener("input", () => { confirmBtn.disabled = !textarea.value.trim(); });
  document.getElementById("modalClose").addEventListener("click", close);
  document.getElementById("modalCancel").addEventListener("click", close);
  confirmBtn.addEventListener("click", () => {
    const comment = textarea.value.trim();
    close();
    onConfirm(comment);
  });
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
