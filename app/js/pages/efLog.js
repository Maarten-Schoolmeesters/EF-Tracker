import { store } from "../dataStore.js";
import { openProposalById } from "./efEntry.js";

let statusFilter = "";
let typeFilter = "";
let searchTerm = "";

export function mountEfLog() {
  document.getElementById("efLogSearch").addEventListener("input", (e) => {
    searchTerm = e.target.value.toLowerCase();
    renderEfLog();
  });
  renderEfLog();
}

export function renderEfLog() {
  const table = document.getElementById("efLogTable");
  if (!table) return;
  const statuses = [...new Set(store.efProposals.map((p) => p.status))];
  const types = [...new Set(store.efProposals.map((p) => p.ef_type))];

  let rows = store.efProposals;
  if (statusFilter) rows = rows.filter((p) => p.status === statusFilter);
  if (typeFilter) rows = rows.filter((p) => p.ef_type === typeFilter);
  if (searchTerm) {
    rows = rows.filter((p) =>
      [p.change_id, p.derived?.newEfName, p.ef_type].join(" ").toLowerCase().includes(searchTerm)
    );
  }

  if (!store.efProposals.length) {
    table.innerHTML = "";
    table.parentElement.previousElementSibling.style.display = "none";
    table.parentElement.innerHTML = `<div class="empty-state"><div class="empty-icon">EF</div><h3>No EF proposals yet</h3><p>Create one from EF Entry and it will appear here.</p></div>`;
    return;
  }

  const filterBar = `
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <select id="statusFilterSel" class="col-filter"><option value="">All statuses</option>${statuses.map((s) => `<option ${s === statusFilter ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select id="typeFilterSel" class="col-filter"><option value="">All EF types</option>${types.map((t) => `<option ${t === typeFilter ? "selected" : ""}>${t}</option>`).join("")}</select>
    </div>`;

  table.innerHTML = `
    <thead><tr>
      <th>Change ID</th><th>Status</th><th>EF Type</th><th>New EF Name</th><th>Proposer</th><th>Reviewer</th>
      <th>Approver</th><th>Last Updated</th><th></th>
    </tr></thead>
    <tbody>
      ${rows.map((p) => `
        <tr>
          <td>${p.change_id}</td>
          <td><span class="pill ${stagePillClass(p.status)}">${p.status}</span></td>
          <td>${p.ef_type}</td>
          <td>${p.derived?.newEfName || "—"}</td>
          <td>${p.derived?.proposerName || "—"}</td>
          <td>${p.derived?.reviewerName || "—"}</td>
          <td>${p.derived?.approverName || "—"}</td>
          <td>${new Date(p.updated_at).toLocaleString()}</td>
          <td style="display:flex;gap:6px">
            <button class="btn" data-open="${p.change_id}" data-stage="${p.status}">Open</button>
            <button class="btn" data-history="${p.change_id}">History</button>
          </td>
        </tr>`).join("")}
    </tbody>`;

  table.insertAdjacentHTML("beforebegin", filterBar);
  const prevBar = table.previousElementSibling;

  prevBar.querySelector("#statusFilterSel").addEventListener("change", (e) => { statusFilter = e.target.value; renderEfLog(); });
  prevBar.querySelector("#typeFilterSel").addEventListener("change", (e) => { typeFilter = e.target.value; renderEfLog(); });

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
    root.innerHTML = `
      <div class="modal-backdrop"><div class="modal">
        <div class="modal-head"><h3>${changeId} · Version History</h3><button class="icon-btn" id="closeHist">✕</button></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <button class="btn" id="prevV" ${idx === 0 ? "disabled" : ""}>← Older</button>
          <span class="pill gray">Version ${v.version_no} · ${v.stage} · ${new Date(v.changed_at).toLocaleString()}</span>
          <button class="btn" id="nextV" ${idx === versions.length - 1 ? "disabled" : ""}>Newer →</button>
        </div>
        <pre style="white-space:pre-wrap;font-size:12px;background:var(--gray-bg);padding:12px;border-radius:8px;max-height:50vh;overflow:auto">${JSON.stringify(v.snapshot, null, 2)}</pre>
      </div></div>`;
    document.getElementById("closeHist").addEventListener("click", () => (root.innerHTML = ""));
    document.getElementById("prevV").addEventListener("click", () => { idx--; render(); });
    document.getElementById("nextV").addEventListener("click", () => { idx++; render(); });
  }
  render();
}
