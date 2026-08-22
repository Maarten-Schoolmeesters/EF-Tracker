// Generic "Excel-like" interconnected checkbox filter group.
//
// Behavior contract:
// - Selecting/deselecting a value in one facet box recomputes the available
//   checkbox options in every other facet box (based on rows matching all
//   *other* current selections).
// - Any selection that becomes inconsistent with the combined state of every
//   other box is automatically pruned (not just hidden) - this runs to a
//   fixed point after every change, so it holds regardless of which box was
//   touched, how many boxes have multiple selections, or the order values
//   were picked in. Without this, stale selections could survive in one box
//   while making every other box show "no matching values" with no way to
//   recover except clearing the whole form.

function uniqueSorted(rows, key) {
  const set = new Set();
  for (const r of rows) {
    const v = r[key];
    if (v !== null && v !== undefined && String(v).trim() !== "") set.add(String(v));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function createFacetFilterGroup({ container, rows, facets, initialSelections = {}, onChange }) {
  const selections = {};
  for (const f of facets) selections[f.key] = new Set(initialSelections[f.key] || []);
  const searchTerms = {};
  for (const f of facets) searchTerms[f.key] = "";

  function rowsMatchingExcept(excludeKey) {
    return rows.filter((r) =>
      facets.every((f) => {
        if (f.key === excludeKey) return true;
        const sel = selections[f.key];
        if (!sel || sel.size === 0) return true;
        return sel.has(String(r[f.key] ?? ""));
      })
    );
  }

  function matchingRows() {
    return rowsMatchingExcept(null);
  }

  // Prune every facet's selections down to values still reachable given every
  // other facet's current selections, repeating until nothing changes -
  // pruning one facet can invalidate another, so a single pass isn't enough.
  function pruneToFixedPoint() {
    let changed = true;
    let guard = 0;
    while (changed && guard < facets.length + 5) {
      changed = false;
      guard++;
      for (const f of facets) {
        if (selections[f.key].size === 0) continue;
        const valid = new Set(uniqueSorted(rowsMatchingExcept(f.key), f.key));
        for (const v of [...selections[f.key]]) {
          if (!valid.has(v)) {
            selections[f.key].delete(v);
            changed = true;
          }
        }
      }
    }
  }

  function render() {
    container.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "facet-grid";
    for (const f of facets) {
      const box = document.createElement("div");
      box.className = "facet-box";

      const label = document.createElement("div");
      label.className = "facet-label";
      label.innerHTML = `<span>${f.label}${f.required ? ' <span class="req">*</span>' : ""}</span><span style="font-weight:400;color:var(--muted)">${selections[f.key].size || ""}</span>`;
      box.appendChild(label);

      const searchInput = document.createElement("input");
      searchInput.type = "text";
      searchInput.placeholder = "Search…";
      searchInput.value = searchTerms[f.key];
      searchInput.addEventListener("input", (e) => {
        searchTerms[f.key] = e.target.value.toLowerCase();
        renderOptionsFor(f, optionsDiv);
      });
      box.appendChild(searchInput);

      const optionsDiv = document.createElement("div");
      optionsDiv.className = "facet-options";
      box.appendChild(optionsDiv);
      renderOptionsFor(f, optionsDiv);

      grid.appendChild(box);
    }
    container.appendChild(grid);
  }

  function renderOptionsFor(f, optionsDiv) {
    optionsDiv.innerHTML = "";
    const available = uniqueSorted(rowsMatchingExcept(f.key), f.key);
    const term = searchTerms[f.key];
    const filtered = term ? available.filter((v) => v.toLowerCase().includes(term)) : available;
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "facet-empty";
      empty.textContent = "No matching values";
      optionsDiv.appendChild(empty);
      return;
    }
    for (const value of filtered) {
      const optLabel = document.createElement("label");
      optLabel.className = "facet-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selections[f.key].has(value);
      cb.addEventListener("change", () => {
        if (cb.checked) selections[f.key].add(value);
        else selections[f.key].delete(value);
        pruneToFixedPoint();
        render();
        onChange && onChange(getSelections(), matchingRows());
      });
      optLabel.appendChild(cb);
      const span = document.createElement("span");
      span.textContent = value;
      optLabel.appendChild(span);
      optionsDiv.appendChild(optLabel);
    }
  }

  function getSelections() {
    const out = {};
    for (const f of facets) out[f.key] = [...selections[f.key]];
    return out;
  }

  pruneToFixedPoint(); // in case initialSelections came in already inconsistent (e.g. reopening a draft)
  render();
  return { getSelections, getMatchingRows: matchingRows, rerender: render };
}
