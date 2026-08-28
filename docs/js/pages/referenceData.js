import { store, updateRow, logAudit, loadTransactionalData } from "../dataStore.js";
import { renderGenericTable } from "../tableUtil.js";
import { SNOW_STATUSES } from "../efLogic.js";
import { toast } from "../toast.js";
import { rerenderIfMounted as rerenderEfEntry } from "./efEntry.js";

const TABS = [
  { key: "users", label: "Users" },
  { key: "efSourcesMethodsAssurance", label: "EF Sources/Methods/Assurance" },
  { key: "carbonAppExport", label: "Carbon App Export" },
  { key: "materialSpecificFactors", label: "Material Specific Factors" },
  { key: "supplierCcfIndex", label: "Supplier CCF Index" },
  { key: "commonId", label: "Common ID" },
  { key: "globalFactorsInventory", label: "Global Factors Inventory" },
  { key: "eeio", label: "EEIO" },
  { key: "eeioEf", label: "EEIO EF" },
  { key: "productMappingRaw", label: "Product Mapping Raw" },
  { key: "productMapping", label: "Product Mapping (derived)" },
  // Deliberately last, low-key location (§7.10) - not backed by a reference
  // CSV like every tab above, so it's excluded from the generic table logic.
  { key: "snowSimulator", label: "SNOW Simulator" },
];

let activeTab = TABS[0].key;

export function mountReferenceData() {
  const tabsEl = document.getElementById("refTabs");
  tabsEl.innerHTML = TABS.map((t) => `<button data-tab="${t.key}" class="${t.key === activeTab ? "active" : ""}">${t.label}</button>`).join("");
  tabsEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      tabsEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab));
      renderActiveTab();
    });
  });
  document.getElementById("refSearch").addEventListener("input", renderActiveTab);
  renderActiveTab();
}

export function renderActiveTab() {
  const tableCard = document.getElementById("refTableCard");
  const snowCard = document.getElementById("snowSimulatorCard");
  if (!tableCard || !snowCard) return;

  if (activeTab === "snowSimulator") {
    tableCard.classList.add("hidden");
    snowCard.classList.remove("hidden");
    renderSnowSimulator(document.getElementById("refSearch").value);
    return;
  }
  tableCard.classList.remove("hidden");
  snowCard.classList.add("hidden");

  const table = document.getElementById("refTable");
  if (!table) return;
  const search = document.getElementById("refSearch").value;
  const rows = store[activeTab] || [];
  const count = renderGenericTable(table, rows, { search });
  document.getElementById("refRowCount").textContent = `${count} of ${rows.length} rows`;
}

// Manual-only tool (§7.10): no background progression, a person picks a
// proposal currently sitting in E4-Ingestion and sets its SNOW ticket status
// one change at a time - a stand-in for the status updates a real
// ServiceNow integration would push in on its own.
function renderSnowSimulator(search) {
  const card = document.getElementById("snowSimulatorCard");
  let rows = store.efProposals.filter((p) => p.status === "E4-Ingestion" && p.snow_ticket_id);
  const term = (search || "").toLowerCase();
  if (term) rows = rows.filter((p) => `${p.change_id} ${p.snow_ticket_id}`.toLowerCase().includes(term));

  card.innerHTML = `
    <div class="card-head"><div><h3>SNOW Simulator</h3><p>Manually simulate a ServiceNow ticket status update for a proposal currently at E4-Ingestion. Nothing here runs automatically - use the search box above to filter by Change ID or Ticket ID.</p></div></div>
    ${!rows.length ? `<p class="empty">No proposals with a raised SNOW ticket right now.</p>` : `
      <div class="table-scroll"><table>
        <thead><tr><th>Change ID</th><th>Ticket ID</th><th>Current Status</th><th>New Status</th><th></th></tr></thead>
        <tbody>
          ${rows.map((p) => `
            <tr>
              <td>${p.change_id}</td>
              <td>${p.snow_ticket_id}</td>
              <td><span class="pill gray">${p.snow_ticket_status || "—"}</span></td>
              <td><select data-status-for="${p.change_id}">
                ${SNOW_STATUSES.map((s) => `<option value="${s}" ${s === p.snow_ticket_status ? "selected" : ""}>${s}</option>`).join("")}
              </select></td>
              <td><button class="btn primary" data-update="${p.change_id}">Update</button></td>
            </tr>`).join("")}
        </tbody>
      </table></div>`}
  `;

  card.querySelectorAll("[data-update]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const changeId = btn.dataset.update;
      const select = card.querySelector(`[data-status-for="${changeId}"]`);
      const newStatus = select.value;
      const proposal = store.efProposals.find((p) => p.change_id === changeId);
      if (!proposal || newStatus === proposal.snow_ticket_status) return;
      const oldStatus = proposal.snow_ticket_status;
      try {
        await updateRow("ef_proposals", "change_id", changeId, { snow_ticket_status: newStatus });
        await logAudit("SNOW Simulator: ticket status updated", "ef_proposal", changeId, { snow_ticket_status: oldStatus }, { snow_ticket_status: newStatus });
        await loadTransactionalData();
        toast(`${changeId}: SNOW ticket ${proposal.snow_ticket_id} set to "${newStatus}"`, "success");
        rerenderEfEntry();
        renderActiveTab();
      } catch (e) { console.error(e); }
    });
  });
}
