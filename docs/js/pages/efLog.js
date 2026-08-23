import { store } from "../dataStore.js";
import { openProposalById } from "./efEntry.js";

let statusFilter = "";
let typeFilter = "";
let materialFilter = "";
let searchTerm = "";

// Material codes on a proposal only apply to the "Supplier Materials EF"
// type (the only type with a Material Code facet) - looked up against
// Carbon App Export for a human-readable name alongside the code.
function materialsForProposal(p) {
  const codes = p.fields?.facets?.material_code || [];
  return codes.map((code) => {
    const row = store.carbonAppExport.find((r) => r.material_code === code);
    return { code, name: row?.material || row?.indicator_name || null };
  });
}

export function mountEfLog() {
  document.getElementById("efLogSearch").addEventListener("input", (e) => {
    searchTerm = e.target.value.toLowerCase();
    renderEfLog();
  });
  renderEfLog();
}

export function renderEfLog() {
  const table = document.getElementById("efLogTable");
  const filterBarEl = document.getElementById("efLogFilterBar");
  const emptyEl = document.getElementById("efLogEmpty");
  const toolbarEl = document.getElementById("efLogToolbar");
  if (!table) return;

  if (!store.efProposals.length) {
    table.closest(".table-scroll").classList.add("hidden");
    filterBarEl.classList.add("hidden");
    toolbarEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    return;
  }
  table.closest(".table-scroll").classList.remove("hidden");
  filterBarEl.classList.remove("hidden");
  toolbarEl.classList.remove("hidden");
  emptyEl.classList.add("hidden");

  const statuses = [...new Set(store.efProposals.map((p) => p.status))];
  const types = [...new Set(store.efProposals.map((p) => p.ef_type))];
  const materialCodes = [...new Set(store.efProposals.flatMap((p) => (p.fields?.facets?.material_code || [])))].sort();

  let rows = store.efProposals;
  if (statusFilter) rows = rows.filter((p) => p.status === statusFilter);
  if (typeFilter) rows = rows.filter((p) => p.ef_type === typeFilter);
  if (materialFilter) rows = rows.filter((p) => (p.fields?.facets?.material_code || []).includes(materialFilter));
  if (searchTerm) {
    rows = rows.filter((p) => {
      const materials = materialsForProposal(p);
      return [
        p.change_id, p.derived?.newEfName, p.ef_type,
        ...materials.map((m) => m.code), ...materials.map((m) => m.name),
      ].join(" ").toLowerCase().includes(searchTerm);
    });
  }

  filterBarEl.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <select id="statusFilterSel" class="col-filter"><option value="">All statuses</option>${statuses.map((s) => `<option ${s === statusFilter ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select id="typeFilterSel" class="col-filter"><option value="">All EF types</option>${types.map((t) => `<option ${t === typeFilter ? "selected" : ""}>${t}</option>`).join("")}</select>
      <select id="materialFilterSel" class="col-filter"><option value="">All material codes</option>${materialCodes.map((m) => `<option ${m === materialFilter ? "selected" : ""}>${m}</option>`).join("")}</select>
    </div>`;
  filterBarEl.querySelector("#statusFilterSel").addEventListener("change", (e) => { statusFilter = e.target.value; renderEfLog(); });
  filterBarEl.querySelector("#typeFilterSel").addEventListener("change", (e) => { typeFilter = e.target.value; renderEfLog(); });
  filterBarEl.querySelector("#materialFilterSel").addEventListener("change", (e) => { materialFilter = e.target.value; renderEfLog(); });

  table.innerHTML = `
    <thead><tr>
      <th>Change ID</th><th>Status</th><th>EF Type</th><th>New EF Name</th><th>Material</th><th>Material Code</th>
      <th>Proposer</th><th>Reviewer</th><th>Approver</th><th>Ingested</th><th>Last Updated</th><th></th>
    </tr></thead>
    <tbody>
      ${rows.map((p) => {
        const materials = materialsForProposal(p);
        const materialNames = materials.map((m) => m.name).filter(Boolean).join(", ") || "—";
        const materialCodesTxt = materials.map((m) => m.code).join(", ") || "—";
        return `
        <tr>
          <td>${p.change_id}</td>
          <td><span class="pill ${stagePillClass(p.status)}">${p.status}</span></td>
          <td>${p.ef_type}</td>
          <td>${p.derived?.newEfName || "—"}</td>
          <td>${materialNames}</td>
          <td>${materialCodesTxt}</td>
          <td>${p.derived?.proposerName || "—"}</td>
          <td>${p.derived?.reviewerName || "—"}</td>
          <td>${p.derived?.approverName || "—"}</td>
          <td>${p.ingested_at ? `<span class="ingested-badge" title="Ingested ${new Date(p.ingested_at).toLocaleDateString()}">✓</span>` : "—"}</td>
          <td>${new Date(p.updated_at).toLocaleString()}</td>
          <td style="display:flex;gap:6px">
            <button class="btn" data-open="${p.change_id}" data-stage="${p.status}">Open</button>
            <button class="btn" data-history="${p.change_id}">History</button>
          </td>
        </tr>`;
      }).join("")}
    </tbody>`;

  table.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => openProposalById(btn.dataset.open, btn.dataset.stage));
  });
  table.querySelectorAll("[data-history]").forEach((btn) => {
    btn.addEventListener("click", () => showVersionHistory(btn.dataset.history));
  });
}

function stagePillClass(status) {
  if (status === "E6-Cancelled") return "red";
  if (status === "E5-OnHold") return "amber";
  if (status === "E4-Ready") return "green";
  return "gray";
}

// Flattens the parts of a snapshot worth comparing between versions into a
// simple path -> displayable-value map (facets, always-fields, derived
// summary, checklist progress) so version-to-version diffs are meaningful
// without hand-writing a comparator per field.
function flattenSnapshot(s) {
  const out = { Status: s.status };
  const facets = s.fields?.facets || {};
  Object.entries(facets).forEach(([k, v]) => {
    const val = (v || []).join(", ");
    if (val) out[`Facet: ${k}`] = val;
  });
  if (s.fields?.newEfValue !== undefined && s.fields?.newEfValue !== null) out["New EF Value"] = s.fields.newEfValue;
  if (s.fields?.newEfUnit) out["New EF Unit"] = s.fields.newEfUnit;
  if (s.fields?.unitMass !== undefined && s.fields?.unitMass !== null) out["Unit Mass (kg)"] = s.fields.unitMass;
  if (s.common_fields?.source) out["Source"] = s.common_fields.source;
  if (s.common_fields?.methodology) out["Methodology"] = s.common_fields.methodology;
  if (s.common_fields?.assurance) out["Assurance"] = s.common_fields.assurance;
  if (s.common_fields?.evidence?.filename) out["Evidence"] = s.common_fields.evidence.filename;
  if (s.common_fields?.comment) out["Proposer comment"] = s.common_fields.comment;
  if (s.derived?.newEfName) out["New EF Name"] = s.derived.newEfName;
  if (s.derived?.reviewerName) out["Reviewer"] = s.derived.reviewerName;
  if (s.derived?.approverName) out["Approver"] = s.derived.approverName;
  if (s.review_steps?.length) out["Checklist progress"] = `${s.review_steps.filter((r) => r.done).length}/${s.review_steps.length}`;
  return out;
}

function diffKeys(prevSnapshot, curSnapshot) {
  const a = prevSnapshot ? flattenSnapshot(prevSnapshot) : {};
  const b = flattenSnapshot(curSnapshot);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed = [];
  for (const k of keys) if (String(a[k] ?? "") !== String(b[k] ?? "")) changed.push(k);
  return changed;
}

function userName(userId) {
  return (store.users.find((u) => u.user_id === userId) || {}).name || userId || "—";
}

function showVersionHistory(changeId) {
  const versions = (store.efProposalVersions || []).filter((v) => v.change_id === changeId).sort((a, b) => a.version_no - b.version_no);
  let idx = versions.length - 1;
  const root = document.getElementById("modalRoot");

  function render() {
    if (!versions.length) {
      root.innerHTML = `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h3>${changeId} · Version History</h3><button class="icon-btn" id="closeHist">✕</button></div><p class="empty">No version snapshots yet.</p></div></div>`;
      document.getElementById("closeHist").addEventListener("click", () => (root.innerHTML = ""));
      return;
    }
    const v = versions[idx];
    const prev = versions[idx - 1] || null;
    // v1 has no prior version to have changed from - diffing against nothing
    // would otherwise mark every field "changed", which is misleading.
    const changed = idx === 0 ? [] : diffKeys(prev?.snapshot, v.snapshot);
    const prevFlat = prev ? flattenSnapshot(prev.snapshot) : {};
    const curFlat = flattenSnapshot(v.snapshot);

    const tableRows = versions.map((ver, i) => {
      const changedVsPrior = diffKeys((versions[i - 1] || {}).snapshot, ver.snapshot);
      return `<tr class="${i === idx ? "selected-version" : ""}" data-idx="${i}">
        <td>v${ver.version_no}</td>
        <td><span class="pill ${stagePillClass(ver.stage)}">${ver.stage}</span></td>
        <td>${ver.action_label || "—"}</td>
        <td>${userName(ver.changed_by)}</td>
        <td>${new Date(ver.changed_at).toLocaleString()}</td>
        <td>${i === 0 ? "Initial version" : (changedVsPrior.length ? changedVsPrior.join(", ") : "No change")}</td>
      </tr>`;
    }).join("");

    const detailRows = Object.keys(curFlat).map((k) => {
      const isChanged = changed.includes(k);
      const wasVal = prevFlat[k];
      return `<div class="derived-row${isChanged ? " changed" : ""}">
        <div class="k">${k}</div>
        <div class="v">${curFlat[k]}</div>
        ${isChanged && wasVal !== undefined ? `<div class="was">was: ${wasVal}</div>` : ""}
      </div>`;
    }).join("");

    root.innerHTML = `
      <div class="modal-backdrop"><div class="modal" style="width:min(880px,94vw)">
        <div class="modal-head"><h3>${changeId} · Version History</h3><button class="icon-btn" id="closeHist">✕</button></div>

        <div class="version-table-wrap"><table>
          <thead><tr><th>Version</th><th>Stage</th><th>Action</th><th>Changed by</th><th>When</th><th>What changed</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table></div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <button class="btn" id="prevV" ${idx === 0 ? "disabled" : ""}>← Older</button>
          <span class="pill gray">Version ${v.version_no} · ${v.stage}${v.action_label ? " · " + v.action_label : ""} · ${new Date(v.changed_at).toLocaleString()}</span>
          <button class="btn" id="nextV" ${idx === versions.length - 1 ? "disabled" : ""}>Newer →</button>
        </div>
        <div style="max-height:40vh;overflow-y:auto">${detailRows}</div>
      </div></div>`;

    document.getElementById("closeHist").addEventListener("click", () => (root.innerHTML = ""));
    document.getElementById("prevV").addEventListener("click", () => { idx--; render(); });
    document.getElementById("nextV").addEventListener("click", () => { idx++; render(); });
    root.querySelectorAll(".version-table-wrap tr[data-idx]").forEach((tr) => {
      tr.addEventListener("click", () => { idx = Number(tr.dataset.idx); render(); });
    });
  }
  render();
}
