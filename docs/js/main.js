import { isConfigured } from "./supabaseClient.js";
import { store, loadReferenceData, loadTransactionalData } from "./dataStore.js";
import { toast } from "./toast.js";
import { renderDashboard } from "./pages/dashboard.js";
import { mountEfEntry } from "./pages/efEntry.js";
import { mountEfLog, renderEfLog } from "./pages/efLog.js";
import { mountReferenceData, renderActiveTab } from "./pages/referenceData.js";
import { mountAudit, renderAudit } from "./pages/audit.js";
import { mountNotifications, renderNotifBadge } from "./notifications.js";

const PAGE_META = {
  dashboard: ["Dashboard", "Quick status overview of emission factor proposals and reference data"],
  "ef-entry": ["EF Entry", "Create, review, approve and track an EF proposal through its lifecycle"],
  "ef-log": ["EF Log", "All EF proposals with current stage, status and latest details"],
  reference: ["Reference Data", "Latest data as loaded from the backend"],
  audit: ["Audit log", "Every important action, tracked by user and timestamp"],
};

function showPage(pageKey) {
  document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === pageKey));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${pageKey}`));
  const [title, subtitle] = PAGE_META[pageKey];
  document.getElementById("topTitle").textContent = title;
  document.getElementById("topSubtitle").textContent = subtitle;
  if (pageKey === "dashboard") renderDashboard();
  if (pageKey === "ef-log") renderEfLog();
  if (pageKey === "reference") renderActiveTab();
  if (pageKey === "audit") renderAudit();
}

function wireNav() {
  document.querySelectorAll(".nav button[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  });
  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => document.querySelector(`.nav button[data-page="${btn.dataset.go}"]`).click());
  });
}

function populateUserSelect() {
  const sel = document.getElementById("currentUserSelect");
  sel.innerHTML = store.users.map((u) => `<option value="${u.user_id}">${u.name} (${(u.roles || []).join(", ") || "no role"})</option>`).join("");
  sel.value = store.currentUserId;
  sel.addEventListener("change", () => {
    store.currentUserId = sel.value;
    renderNotifBadge();
    renderDashboard();
  });
}

async function resync() {
  toast("Resyncing reference data…");
  await loadReferenceData();
  await loadTransactionalData();
  populateUserSelect();
  renderNotifBadge();
  renderDashboard();
  toast("Reference data resynced", "success");
}

async function init() {
  wireNav();
  mountNotifications();
  document.getElementById("resyncBtn").addEventListener("click", resync);

  if (!isConfigured) {
    toast("Supabase not configured yet - edit app/js/config.js with your project URL and anon key.", "error");
  }

  await loadReferenceData();
  await loadTransactionalData();
  populateUserSelect();
  renderNotifBadge();

  mountEfEntry();
  mountEfLog();
  mountReferenceData();
  mountAudit();

  showPage("dashboard");
}

init();
