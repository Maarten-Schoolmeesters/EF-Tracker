// Small reusable "info icon with hover explanation" for any calculated
// field - pure CSS tooltip (see .info-icon in styles.css), so no JS wiring
// needed per instance beyond dropping this markup next to a label/value.
export function infoIcon(explanation) {
  const escaped = explanation.replace(/"/g, "&quot;");
  return `<span class="info-icon" tabindex="0" data-tooltip="${escaped}">i</span>`;
}
