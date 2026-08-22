export function toast(message, kind = "") {
  const stack = document.getElementById("toastStack");
  if (!stack) { console.log(message); return; }
  const el = document.createElement("div");
  el.className = `toast ${kind}`.trim();
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
