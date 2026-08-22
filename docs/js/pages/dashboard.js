import { store, currentUser } from "../dataStore.js";
import { isConfigured } from "../supabaseClient.js";
import { STAGES } from "../efLogic.js";

export function renderDashboard() {
  renderSyncNotice();
  renderKpis();
  renderStageBreakdown();
  renderRecentActivity();
}

function renderSyncNotice() {
  const el = document.getElementById("syncNotice");
  if (!el) return;
  if (!isConfigured) {
    el.className = "notice warn";
    el.textContent = "Supabase is not configured yet - edit app/js/config.js with your project URL and anon key, then reload.";
    return;
  }
  if (!store.lastSync) { el.textContent = "Reference data not loaded yet."; return; }
  const total = store.carbonAppExport.length + store.commonId.length + store.eeio.length + store.productMappingRaw.length;
  el.className = "notice info";
  el.textContent = `Reference data synced ${store.lastSync.toLocaleString()} · ${total.toLocaleString()} reference rows loaded across 9 tables.`;
}

function renderKpis() {
  const el = document.getElementById("dashboardKpis");
  const open = store.efProposals.filter((p) => !["E4-Ready", "E6-Cancelled"].includes(p.status));
  const user = currentUser();
  const awaiting = store.efProposals.filter((p) =>
    (p.status === "E2-Review" && p.reviewer_id === user?.user_id) ||
    (p.status === "E3-Approval" && p.approver_id === user?.user_id)
  );
  const cards = [
    ["Open EF proposals", open.length, "Across E1-Draft to E3-Approval"],
    ["Awaiting your action", awaiting.length, user ? `As ${user.name}` : "—"],
    ["Ready for ingestion", store.efProposals.filter((p) => p.status === "E4-Ready").length, "Manual step into Carbon App"],
    ["Total EF proposals", store.efProposals.length, "All statuses, all time"],
  ];
  el.innerHTML = cards.map(([label, value, caption]) => `
    <div class="kpi"><div class="top"><span class="caption">${label}</span></div><strong>${value}</strong><span class="caption">${caption}</span></div>
  `).join("");
}

function renderStageBreakdown() {
  const el = document.getElementById("stageBreakdown");
  const total = store.efProposals.length || 1;
  el.innerHTML = STAGES.map((s) => {
    const count = store.efProposals.filter((p) => p.status === s.code).length;
    const pct = Math.round((count / total) * 100);
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>${s.label}</span><span>${count}</span></div>
        <div style="background:var(--gray-bg);border-radius:6px;height:8px;overflow:hidden"><div style="width:${pct}%;background:var(--primary);height:100%"></div></div>
      </div>`;
  }).join("");
}

function renderRecentActivity() {
  const el = document.getElementById("recentActivity");
  const recent = store.auditLog.slice(0, 8);
  if (!recent.length) { el.innerHTML = `<p class="empty">No activity yet.</p>`; return; }
  el.innerHTML = recent.map((r) => {
    const user = store.users.find((u) => u.user_id === r.user_id);
    return `<div class="derived-row"><div class="k">${new Date(r.at).toLocaleString()}</div><div class="v">${user?.name || r.user_id}: ${r.action} <span class="pill gray">${r.object_id || ""}</span></div></div>`;
  }).join("");
}
