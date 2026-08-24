import { store, currentUser } from "../dataStore.js";
import { isConfigured } from "../supabaseClient.js";
import { STAGES, resolveCurrentEfTier, newEfPerKg, materialDeltaForRow } from "../efLogic.js";

let efTypeMetric = "number"; // "number" | "emissions" - which basis the pie chart weights by
let onlyTop75 = false; // restrict the pie chart to the smallest set of materials whose combined YTD emissions reach 75% of the total

export function renderDashboard() {
  renderSyncNotice();
  renderKpis();
  renderStageBreakdown();
  renderRecentActivity();
  renderEfTypeDistribution();
  renderTopMaterials();
  wireDashboardControls();
}

let controlsWired = false;
function wireDashboardControls() {
  if (controlsWired) return; // static controls, wire listeners once - re-render just updates their content/state
  controlsWired = true;
  document.getElementById("efTypeMetricToggle")?.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      efTypeMetric = btn.dataset.metric;
      renderEfTypeDistribution();
    });
  });
  document.getElementById("top75Switch")?.addEventListener("click", () => {
    onlyTop75 = !onlyTop75;
    renderEfTypeDistribution();
  });
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

// Illustrative tCO2e impact if every Material Specific EF proposal
// currently sitting in this stage had its new EF applied in place of the
// current one - summed across all of that proposal's material codes, using
// the same delta math as the EF Entry impact panel. The other 3 EF types
// have no tonnage basis to estimate from (same limitation as EF Entry), so
// only Material Specific EF proposals contribute here.
function stageImpact(stageCode) {
  const proposals = store.efProposals.filter((p) => p.status === stageCode && p.ef_type === "Material Specific EF");
  let ytd = 0, prevYr = 0, anyYtd = false, anyPrevYr = false;
  for (const p of proposals) {
    const materialCodes = p.fields?.facets?.material_code || [];
    const perKg = newEfPerKg(p.fields?.newEfValue, p.fields?.newEfUnit, p.fields?.unitMass);
    if (perKg === null) continue;
    for (const mc of materialCodes) {
      const caeRows = store.carbonAppExport.filter((r) => r.material_code === mc).sort((a, b) => a.year - b.year);
      const latest = caeRows[caeRows.length - 1] || null;
      const previous = caeRows.length > 1 ? caeRows[caeRows.length - 2] : null;
      const dYtd = materialDeltaForRow(latest, perKg);
      const dPrev = materialDeltaForRow(previous, perKg);
      if (dYtd !== null) { ytd += dYtd; anyYtd = true; }
      if (dPrev !== null) { prevYr += dPrev; anyPrevYr = true; }
    }
  }
  return { ytd, prevYr, anyYtd, anyPrevYr };
}

function impactValueHtml(value, any) {
  if (!any) return `<span class="val na">n/a</span>`;
  const dir = Math.abs(value) < 0.05 ? "" : value > 0 ? "up" : "down";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `<span class="val ${dir}">${sign}${Math.abs(value).toFixed(0)}t</span>`;
}

function renderStageBreakdown() {
  const el = document.getElementById("stageBreakdown");
  const total = store.efProposals.length || 1;
  el.innerHTML = STAGES.map((s) => {
    const count = store.efProposals.filter((p) => p.status === s.code).length;
    const pct = Math.round((count / total) * 100);
    const impact = count ? stageImpact(s.code) : null;
    return `
      <div class="stage-item">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>${s.label}</span><span>${count}</span></div>
        <div style="background:var(--gray-bg);border-radius:6px;height:8px;overflow:hidden"><div style="width:${pct}%;background:var(--primary);height:100%"></div></div>
        ${impact && (impact.anyYtd || impact.anyPrevYr) ? `
          <div class="impact-mini">
            <span><span class="seg-label">YTD</span> ${impactValueHtml(impact.ytd, impact.anyYtd)}</span>
            <span><span class="seg-label">Prev Yr</span> ${impactValueHtml(impact.prevYr, impact.anyPrevYr)}</span>
          </div>` : ""}
      </div>`;
  }).join("") + `
    <div class="limitation">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
      Illustrative: based on each material's recorded tonnage, summed across every Material Specific EF proposal in that stage. Proposals whose materials have a spend-based current EF (no tonnage on record) are excluded from the total, not counted as zero.
    </div>`;
}

const PIE_COLORS = ["var(--primary)", "var(--accent)", "var(--primary-dark)", "var(--amber)", "var(--muted)"];

// Latest-year Carbon App Export row per material code - the basis for both
// the pie chart and the top-75%-emitters cut, consistent with how "current"
// figures are resolved everywhere else in the app (most recent year only).
function latestRowsByMaterial() {
  const byMaterial = new Map();
  for (const r of store.carbonAppExport) {
    const existing = byMaterial.get(r.material_code);
    if (!existing || Number(r.year) > Number(existing.year)) byMaterial.set(r.material_code, r);
  }
  return [...byMaterial.values()];
}

function renderEfTypeDistribution() {
  const el = document.getElementById("efTypeDistribution");
  if (!el) return;

  document.querySelectorAll("#efTypeMetricToggle button").forEach((btn) => btn.classList.toggle("active", btn.dataset.metric === efTypeMetric));
  const switchEl = document.getElementById("top75Switch");
  switchEl?.classList.toggle("on", onlyTop75);

  let rows = latestRowsByMaterial().sort((a, b) => Number(b.co2e_mt || 0) - Number(a.co2e_mt || 0));
  const totalEmissions = rows.reduce((s, r) => s + Number(r.co2e_mt || 0), 0);
  let cutCount = rows.length;
  if (onlyTop75 && totalEmissions > 0) {
    let cum = 0;
    cutCount = 0;
    for (const r of rows) {
      if (cum >= totalEmissions * 0.75) break;
      cum += Number(r.co2e_mt || 0);
      cutCount++;
    }
    rows = rows.slice(0, cutCount);
  }
  const top75Label = document.getElementById("top75Label");
  if (top75Label) top75Label.innerHTML = `Only top 75% CO2-emitting materials ${onlyTop75 ? `<strong>(on — ${cutCount} of ${latestRowsByMaterial().length} materials)</strong>` : ""}`;

  if (!rows.length) { el.innerHTML = `<p class="empty">No Carbon App Export data loaded.</p>`; return; }

  const byType = new Map();
  for (const r of rows) {
    const tier = resolveCurrentEfTier(r.co2_factor_name_final);
    const label = tier ? tier.tier : "Unrecognized";
    const weight = efTypeMetric === "emissions" ? Number(r.co2e_mt || 0) : 1;
    byType.set(label, (byType.get(label) || 0) + weight);
  }
  const entries = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  let cursor = 0;
  const stops = entries.map(([, v], i) => {
    const pct = (v / total) * 100;
    const stop = `${PIE_COLORS[i % PIE_COLORS.length]} ${cursor}% ${cursor + pct}%`;
    cursor += pct;
    return stop;
  }).join(", ");

  el.innerHTML = `
    <div class="pie-row">
      <div class="pie" style="background:conic-gradient(${stops})"></div>
      <div class="pie-legend">
        ${entries.map(([label, v], i) => `
          <div class="row">
            <span class="swatch" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>
            <span class="name">${label}</span>
            <span class="n">${efTypeMetric === "number" ? v : fmtTonnes(v)}</span>
            <span class="pct">${((v / total) * 100).toFixed(0)}%</span>
          </div>`).join("")}
      </div>
    </div>`;
}

function fmtTonnes(v) {
  return v === null || v === undefined || isNaN(v) ? "—" : `${Number(v).toFixed(1)}t CO2e`;
}

// Furthest-along active (non-cancelled) proposal referencing this material
// code, if any - "furthest along" ranks toward ingestion (E4 highest), with
// On Hold ranked below every actively-progressing stage since it's paused,
// not advancing. A material can have more than one active proposal; only
// the single most-advanced one is surfaced, kept to one glanceable pill.
const PIPELINE_STAGE_RANK = { "E4-Ready": 4, "E3-Approval": 3, "E2-Review": 2, "E1-Draft": 1, "E5-OnHold": 0 };
function pipelineStatusForMaterial(materialCode) {
  const active = store.efProposals.filter((p) =>
    p.status !== "E6-Cancelled" && (p.fields?.facets?.material_code || []).includes(materialCode)
  );
  if (!active.length) return null;
  return active.reduce((best, p) => (PIPELINE_STAGE_RANK[p.status] > PIPELINE_STAGE_RANK[best.status] ? p : best), active[0]).status;
}

function pipelinePillHtml(status) {
  if (!status) return `<span class="pipeline-pill none">No active proposal</span>`;
  const cls = status === "E4-Ready" ? "ready" : status === "E5-OnHold" ? "hold" : "active";
  return `<span class="pipeline-pill ${cls}">${status}</span>`;
}

const TOP_MATERIALS_SHOWN = 15;

// Ranks materials by their most recent year's Scope 3-1a emissions
// (Carbon App Export's own co2e_mt) - a leaderboard of where the biggest
// impact opportunity is, using the same trusted-export values the EF Entry
// impact panel is built on (see resolveCurrentEfTier). Internally
// scrollable rather than growing the page, so the pane's height stays
// predictable next to its neighbor.
function renderTopMaterials() {
  const el = document.getElementById("topMaterialsLeaderboard");
  const caption = document.getElementById("topMaterialsCaption");
  if (!el) return;
  const all = latestRowsByMaterial().sort((a, b) => Number(b.co2e_mt || 0) - Number(a.co2e_mt || 0));
  if (!all.length) { el.innerHTML = `<p class="empty">No Carbon App Export data loaded.</p>`; return; }
  const rows = all.slice(0, TOP_MATERIALS_SHOWN);
  if (caption) caption.textContent = `By most recent year's Scope 3-1a emissions · showing ${rows.length} of ${all.length}`;
  const maxEmissions = Number(rows[0]?.co2e_mt || 0) || 1;
  el.innerHTML = rows.map((r) => {
    const tier = resolveCurrentEfTier(r.co2_factor_name_final);
    const pct = (Number(r.co2e_mt || 0) / maxEmissions) * 100;
    return `
      <div class="mat-row">
        <div class="mat-top"><span class="name">${r.material || r.indicator_name} <span class="code">${r.material_code}</span></span><strong>${fmtTonnes(r.co2e_mt)}</strong></div>
        <div style="background:var(--gray-bg);border-radius:6px;height:6px;overflow:hidden;margin-bottom:6px"><div style="width:${pct}%;background:var(--primary);height:100%"></div></div>
        <div class="mat-meta"><span>${tier?.tier || "—"} · ${r.supplier_name || "—"}</span>${pipelinePillHtml(pipelineStatusForMaterial(r.material_code))}</div>
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
