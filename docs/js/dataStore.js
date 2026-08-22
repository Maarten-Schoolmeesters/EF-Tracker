import { supabase, isConfigured } from "./supabaseClient.js";
import { toast } from "./toast.js";

// In-memory cache of everything the app needs. Reference tables are refreshed
// via loadReferenceData() (called on load and on "Resync"); transactional
// tables are refreshed on demand by each page after a write.
export const store = {
  lastSync: null,
  users: [],
  efSourcesMethodsAssurance: [],
  carbonAppExport: [],
  materialSpecificFactors: [],
  supplierCcfIndex: [],
  commonId: [],
  globalFactorsInventory: [],
  eeio: [],
  eeioEf: [],
  productMappingRaw: [],
  productMapping: [], // derived view
  efProposals: [],
  efProposalVersions: [],
  auditLog: [],
  notifications: [],
  currentUserId: null,
};

async function fetchAll(table, orderCol) {
  if (!isConfigured) return [];
  let query = supabase.from(table).select("*");
  if (orderCol) query = query.order(orderCol, { ascending: true });
  const { data, error } = await query.limit(20000);
  if (error) {
    console.error(`fetch ${table} failed`, error);
    toast(`Failed to load ${table}: ${error.message}`, "error");
    return [];
  }
  return data;
}

export async function loadReferenceData() {
  if (!isConfigured) {
    toast("Supabase is not configured yet - edit app/js/config.js", "error");
    return;
  }
  const [
    users, esma, cae, msf, ccf, commonId, gfi, eeio, eeioEf, pmr, productMapping,
  ] = await Promise.all([
    fetchAll("users", "name"),
    fetchAll("ef_sources_methods_assurance", "id"),
    fetchAll("carbon_app_export", "material_code"),
    fetchAll("material_specific_factors", "material_code"),
    fetchAll("supplier_ccf_index", "supplier_number"),
    fetchAll("common_id", "material_id"),
    fetchAll("global_factors_inventory", "common_id1"),
    fetchAll("eeio", "enriched_l1l2l3_classification"),
    fetchAll("eeio_ef", "enriched_l1l2l3_classification"),
    fetchAll("product_mapping_raw", "material_id_code"),
    fetchAll("product_mapping", "material_id_code"),
  ]);
  store.users = users;
  store.efSourcesMethodsAssurance = esma;
  store.carbonAppExport = cae;
  store.materialSpecificFactors = msf;
  store.supplierCcfIndex = ccf;
  store.commonId = commonId;
  store.globalFactorsInventory = gfi;
  store.eeio = eeio;
  store.eeioEf = eeioEf;
  store.productMappingRaw = pmr;
  store.productMapping = productMapping;
  store.lastSync = new Date();
  if (!store.currentUserId && users.length) store.currentUserId = users[0].user_id;
}

export async function loadTransactionalData() {
  if (!isConfigured) return;
  const [proposals, versions, auditLog, notifications] = await Promise.all([
    fetchAll("ef_proposals", "updated_at"),
    fetchAll("ef_proposal_versions", "version_no"),
    fetchAll("audit_log", "at"),
    fetchAll("notifications", "created_at"),
  ]);
  store.efProposals = proposals.reverse();
  store.efProposalVersions = versions;
  store.auditLog = auditLog.reverse();
  store.notifications = notifications.reverse();
}

export function currentUser() {
  return store.users.find((u) => u.user_id === store.currentUserId) || null;
}

export async function insertRow(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select();
  if (error) { toast(`${table} insert failed: ${error.message}`, "error"); throw error; }
  return data[0];
}

export async function updateRow(table, matchCol, matchVal, patch) {
  const { data, error } = await supabase.from(table).update(patch).eq(matchCol, matchVal).select();
  if (error) { toast(`${table} update failed: ${error.message}`, "error"); throw error; }
  return data[0];
}

export async function logAudit(action, objectType, objectId, oldValue, newValue) {
  await insertRow("audit_log", {
    user_id: store.currentUserId,
    action,
    object_type: objectType,
    object_id: objectId,
    old_value: oldValue ?? null,
    new_value: newValue ?? null,
  });
}

// Inserts a new version snapshot only if it actually differs from the most
// recent one on record for this change_id - repeated no-op "Save Draft"
// clicks shouldn't spam the version history.
// Deliberately swallows its own errors (logged, not thrown): version history
// is a secondary record of what happened, and a failure writing it (e.g. a
// schema not yet migrated) must never abort saving the actual proposal.
export async function maybeInsertVersion(changeId, stage, actionLabel, snapshot) {
  try {
    const prior = store.efProposalVersions
      .filter((v) => v.change_id === changeId)
      .sort((a, b) => a.version_no - b.version_no);
    const last = prior[prior.length - 1];
    if (last && JSON.stringify(last.snapshot) === JSON.stringify(snapshot)) return null;
    const { data, error } = await supabase.from("ef_proposal_versions").insert({
      change_id: changeId,
      version_no: prior.length + 1,
      stage,
      action_label: actionLabel,
      snapshot,
      changed_by: store.currentUserId,
    }).select();
    if (error) throw error;
    const row = data[0];
    store.efProposalVersions.push(row);
    return row;
  } catch (e) {
    console.error("maybeInsertVersion failed (non-fatal):", e);
    toast("Couldn't save a version-history entry (see console) - the proposal itself was saved fine.", "error");
    return null;
  }
}

export async function adjustUserCount(userId, field, delta) {
  if (!userId) return;
  const user = store.users.find((u) => u.user_id === userId);
  if (!user) return;
  const next = Math.max(0, (user[field] || 0) + delta);
  await updateRow("users", "user_id", userId, { [field]: next });
  user[field] = next; // keep local cache in sync so back-to-back assignments in the same session stay accurate
}

export async function notify(userId, message, changeId) {
  if (!userId) return;
  await insertRow("notifications", {
    user_id: userId,
    message,
    related_change_id: changeId ?? null,
  });
}
