import { store } from "../dataStore.js";
import { renderGenericTable } from "../tableUtil.js";

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
  const table = document.getElementById("refTable");
  if (!table) return;
  const search = document.getElementById("refSearch").value;
  const rows = store[activeTab] || [];
  const count = renderGenericTable(table, rows, { search });
  document.getElementById("refRowCount").textContent = `${count} of ${rows.length} rows`;
}
