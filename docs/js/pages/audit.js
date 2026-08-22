import { store } from "../dataStore.js";
import { renderGenericTable } from "../tableUtil.js";

export function mountAudit() {
  document.getElementById("auditSearch").addEventListener("input", renderAudit);
  renderAudit();
}

export function renderAudit() {
  const table = document.getElementById("auditTable");
  if (!table) return;
  const search = document.getElementById("auditSearch").value.toLowerCase();
  const rows = store.auditLog.map((r) => ({
    at: new Date(r.at).toLocaleString(),
    user: (store.users.find((u) => u.user_id === r.user_id) || {}).name || r.user_id,
    action: r.action,
    object_type: r.object_type,
    object_id: r.object_id,
  }));
  renderGenericTable(table, rows, { search });
}
