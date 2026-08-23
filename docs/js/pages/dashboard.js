import { store, currentUser } from "../dataStore.js";
import { isConfigured } from "../supabaseClient.js";
import { STAGES, EF_TYPES, resolveCurrentEfTier } from "../efLogic.js";

export function renderDashboard() {
  renderSyncNotice();
  renderKpis();
  renderStageBreakdown();
  renderRecentActivity();
  renderEfTypeBreakdown();
  renderTopMaterials();
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

function stageColor(code) {
  if (code === "E6-Cancelled") return "var(--red)";
  if (code === "E5-OnHold") return "var(--amber)";
  if (code === "E4-Ready") return "var(--green)";
  return "var(--primary)";
}

function renderEfTypeBreakdown() {
  const el = document.getElementById("efTypeBreakdown");
  if (!el) return;
  const rows = EF_TYPES.map((type) => {
    const proposals = store.efProposals.filter((p) => p.ef_type === type);
    const ingested = proposals.filter((p) => p.ingested_at).length;
    const stageCounts = STAGES.map((s) => ({ ...s, count: proposals.filter((p) => p.status === s.code).length }));
    return { type, total: proposals.length, ingested, stageCounts };
  });
  if (!rows.some((r) => r.total)) { el.innerHTML = `<p class="empty">No EF proposals yet.</p>`; return; }
  el.innerHTML = rows.map((r) => `
    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;gap:10px">
        <strong style="font-size:12.5px">${r.type}</strong>
        <span class="caption" style="white-space:nowrap">${r.ingested} ingested · ${r.total} total</span>
      </div>
      <div style="display:flex;height:8px;border-radius:6px;overflow:hidden;background:var(--gray-bg)">
        ${r.total ? r.stageCounts.map((s) => s.count ? `<div style="width:${(s.count / r.total) * 100}%;background:${stageColor(s.code)}" title="${s.label}: ${s.count}"></div>` : "").join("") : ""}
      </div>
    </div>`).join("");
}

function fmtTonnes(v) {
  return v === null || v === undefined || isNaN(v) ? "—" : `${Number(v).toFixed(1)}t CO2e`;
}

// Ranks materials by their most recent year's Scope 3-1a emissions
// (Carbon App Export's own co2e_mt) - a leaderboard of where the biggest
// impact opportunity is, using the same trusted-export values the EF Entry
// impact panel is built on (see resolveCurrentEfTier).
function renderTopMaterials() {
  const el = document.getElementById("topMaterialsLeaderboard");
  if (!el) return;
  if (!store.carbonAppExport.length) { el.innerHTML = `<p class="empty">No Carbon App Export data loaded.</p>`; return; }
  const latestYear = Math.max(...store.carbonAppExport.map((r) => Number(r.year)));
  const rows = store.carbonAppExport
    .filter((r) => Number(r.year) === latestYear)
    .slice()
    .sort((a, b) => Number(b.co2e_mt || 0) - Number(a.co2e_mt || 0))
    .slice(0, 8);
  const maxEmissions = Number(rows[0]?.co2e_mt || 0) || 1;
  el.innerHTML = rows.map((r) => {
    const tier = resolveCurrentEfTier(r.co2_factor_name_final);
    const pct = (Number(r.co2e_mt || 0) / maxEmissions) * 100;
    return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px;gap:10px">
          <span>${r.material || r.indicator_name} <span class="caption">(${r.material_code})</span></span>
          <strong style="white-space:nowrap">${fmtTonnes(r.co2e_mt)}</strong>
        </div>
        <div style="background:var(--gray-bg);border-radius:6px;height:8px;overflow:hidden"><div style="width:${pct}%;background:var(--primary);height:100%"></div></div>
        <span class="caption">${tier?.tier || "—"} · ${r.supplier_name || "—"}</span>
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
