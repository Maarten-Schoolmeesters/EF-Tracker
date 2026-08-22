import { isConfigured } from "./supabaseClient.js";
import { store, loadReferenceData, loadTransactionalData } from "./dataStore.js";
import { toast } from "./toast.js";
import { registerPageChangeHandler } from "./nav.js";
import { renderDashboard } from "./pages/dashboard.js";
import { mountEfEntry, confirmDiscardIfDirty, forceBlankDraft, rerenderIfMounted } from "./pages/efEntry.js";
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

let currentPage = "dashboard";

function renderCurrentPage() {
  if (currentPage === "dashboard") renderDashboard();
  if (currentPage === "ef-entry") rerenderIfMounted();
  if (currentPage === "ef-log") renderEfLog();
  if (currentPage === "reference") renderActiveTab();
  if (currentPage === "audit") renderAudit();
}

function showPage(pageKey) {
  currentPage = pageKey;
  document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === pageKey));
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${pageKey}`));
  const [title, subtitle] = PAGE_META[pageKey];
  document.getElementById("topTitle").textContent = title;
  document.getElementById("topSubtitle").textContent = subtitle;
  renderCurrentPage();
}

function wireNav() {
  registerPageChangeHandler(showPage);
  document.querySelectorAll(".nav button[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // The EF Entry nav button must always land on a fresh blank Draft,
      // never silently resume whatever proposal was last open - but both
      // paths still go through the unsaved-changes guard first, and must
      // only navigate if the guard's callback actually runs (not if the
      // user chose "Stay here").
      if (btn.dataset.page === "ef-entry") {
        confirmDiscardIfDirty(() => { forceBlankDraft(); showPage("ef-entry"); });
      } else {
        confirmDiscardIfDirty(() => showPage(btn.dataset.page));
      }
    });
  });
  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => document.querySelector(`.nav button[data-page="${btn.dataset.go}"]`).click());
  });
}

// Repopulates <option> lists to match current data/state. Safe to call
// repeatedly (e.g. on every resync) since it never attaches listeners -
// that happens once in wireUserAndRoleSelectors().
function populateRoleSelect() {
  const roleSel = document.getElementById("currentRoleSelect");
  const user = store.users.find((u) => u.user_id === store.currentUserId);
  const roles = user?.roles || [];
  roleSel.innerHTML = roles.length
    ? roles.map((r) => `<option value="${r}">${r}</option>`).join("")
    : `<option value="">No roles assigned</option>`;
  if (!roles.includes(store.currentActiveRole)) store.currentActiveRole = roles[0] || null;
  roleSel.value = store.currentActiveRole || "";
  roleSel.disabled = roles.length === 0;
}

function populateUserSelect() {
  const sel = document.getElementById("currentUserSelect");
  sel.innerHTML = store.users.map((u) => `<option value="${u.user_id}">${u.name} (${(u.roles || []).join(", ") || "no role"})</option>`).join("");
  sel.value = store.currentUserId;
  populateRoleSelect();
}

// One-time listener wiring - called once from init(), NOT from resync(),
// so resyncing the dropdowns' options doesn't stack duplicate handlers.
function wireUserAndRoleSelectors() {
  document.getElementById("currentUserSelect").addEventListener("change", (e) => {
    store.currentUserId = e.target.value;
    store.currentActiveRole = null; // force re-pick from the new user's own roles
    populateRoleSelect();
    renderNotifBadge();
    renderCurrentPage();
  });
  document.getElementById("currentRoleSelect").addEventListener("change", (e) => {
    store.currentActiveRole = e.target.value || null;
    renderCurrentPage();
  });
}

async function resync() {
  const btn = document.getElementById("resyncBtn");
  btn.classList.add("resync-spin");
  btn.disabled = true;
  toast("Resyncing reference data…");
  try {
    await loadReferenceData();
    await loadTransactionalData();
    populateUserSelect();
    renderNotifBadge();
    renderCurrentPage();
    toast("Reference data resynced", "success");
  } finally {
    btn.classList.remove("resync-spin");
    btn.disabled = false;
  }
}

async function init() {
  wireNav();
  wireUserAndRoleSelectors();
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
