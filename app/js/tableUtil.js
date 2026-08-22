export function titleCase(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function renderGenericTable(tableEl, rows, { search = "", excludeCols = ["id"] } = {}) {
  if (!rows.length) {
    tableEl.innerHTML = `<tbody><tr><td class="empty">No rows.</td></tr></tbody>`;
    return 0;
  }
  const cols = Object.keys(rows[0]).filter((c) => !excludeCols.includes(c));
  const term = search.toLowerCase();
  const filtered = term
    ? rows.filter((r) => cols.some((c) => String(r[c] ?? "").toLowerCase().includes(term)))
    : rows;

  tableEl.innerHTML = `
    <thead><tr>${cols.map((c) => `<th>${titleCase(c)}</th>`).join("")}</tr></thead>
    <tbody>${filtered.slice(0, 500).map((r) => `<tr>${cols.map((c) => `<td>${formatCell(r[c])}</td>`).join("")}</tr>`).join("")}</tbody>
  `;
  return filtered.length;
}

function formatCell(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
