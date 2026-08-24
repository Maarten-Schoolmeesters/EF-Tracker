// Small reusable "info icon with hover explanation" for any calculated
// field - pure CSS tooltip (see .info-icon in styles.css), so no JS wiring
// needed per instance beyond dropping this markup next to a label/value.
export function infoIcon(explanation) {
  const escaped = explanation.replace(/"/g, "&quot;");
  return `<span class="info-icon" tabindex="0" data-tooltip="${escaped}">i</span>`;
}

// Tooltip triggers inside a horizontally-scrolling table (.table-scroll)
// can't use the CSS-only ::after tooltip above - confirmed live that
// overflow-x:auto forces overflow-y to auto too (a real CSS overflow-spec
// coupling rule, not fixable with overflow-y:visible), which clips any
// tooltip trying to render above a header cell. This positions a floating
// tooltip against document.body instead, escaping the clipping container
// entirely. Call after every render of a table containing [data-tooltip]
// elements (e.g. at the end of renderImpact) - safe to call repeatedly,
// it just re-wires whatever triggers currently exist in the container.
let floatingTooltipEl = null;

function showFloatingTooltip(trigger) {
  hideFloatingTooltip();
  const text = trigger.getAttribute("data-tooltip");
  if (!text) return;
  const el = document.createElement("div");
  el.className = "floating-tooltip";
  el.textContent = text;
  document.body.appendChild(el);
  const rect = trigger.getBoundingClientRect();
  const tRect = el.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tRect.width - 8));
  let top = rect.top - tRect.height - 8;
  if (top < 8) top = rect.bottom + 8; // flip below the trigger if there's no room above
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  floatingTooltipEl = el;
}

function hideFloatingTooltip() {
  if (floatingTooltipEl) { floatingTooltipEl.remove(); floatingTooltipEl = null; }
}

export function wireScrollTableTooltips(containerEl) {
  // Defensive: if a table re-renders (e.g. a page/stage change) while a
  // tooltip from a previous render is still showing, its mouseleave/blur may
  // never fire on the now-removed trigger - drop any leftover instance
  // before wiring the new one, so it can never survive into a fresh render.
  hideFloatingTooltip();
  containerEl.querySelectorAll("[data-tooltip]").forEach((trigger) => {
    trigger.addEventListener("mouseenter", () => showFloatingTooltip(trigger));
    trigger.addEventListener("mouseleave", hideFloatingTooltip);
    trigger.addEventListener("focus", () => showFloatingTooltip(trigger));
    trigger.addEventListener("blur", hideFloatingTooltip);
  });
}
