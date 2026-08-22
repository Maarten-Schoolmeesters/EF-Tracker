import { store, updateRow, loadTransactionalData } from "./dataStore.js";

export function renderNotifBadge() {
  const mine = store.notifications.filter((n) => n.user_id === store.currentUserId && !n.read);
  const badge = document.getElementById("notifCount");
  badge.textContent = mine.length ? mine.length : "";
}

export function mountNotifications() {
  document.getElementById("notifBtn").addEventListener("click", showPanel);
}

function showPanel() {
  const mine = store.notifications.filter((n) => n.user_id === store.currentUserId);
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
    <div class="modal-backdrop"><div class="modal" style="width:420px">
      <div class="modal-head"><h3>Notifications</h3><button class="icon-btn" id="closeNotif">✕</button></div>
      ${mine.length ? mine.slice(0, 20).map((n) => `
        <div class="derived-row">
          <div class="k">${new Date(n.created_at).toLocaleString()}${n.read ? "" : ' <span class="pill amber">new</span>'}</div>
          <div class="v" style="font-weight:400;font-size:13px">${n.message}</div>
        </div>`).join("") : `<p class="empty">No notifications for this user.</p>`}
    </div></div>`;
  document.getElementById("closeNotif").addEventListener("click", async () => {
    root.innerHTML = "";
    const unread = mine.filter((n) => !n.read);
    for (const n of unread) await updateRow("notifications", "id", n.id, { read: true });
    if (unread.length) { await loadTransactionalData(); renderNotifBadge(); }
  });
}
