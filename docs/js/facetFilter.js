// Generic "Excel-like" interconnected checkbox filter group.
//
// Behavior contract:
// - Each facet box defers applying its checkbox changes until its own
//   "Filter" button is clicked - matching Excel's own column-filter dropdown
//   behavior (check multiple values, then OK/Apply). Checking boxes doesn't
//   immediately prune other facets or fire onChange; only a Filter click does.
// - On commit, any OTHER facet's selection that becomes inconsistent with the
//   combined state of every box is automatically pruned (not just hidden) -
//   this runs to a fixed point, so it holds regardless of which box was
//   committed, how many boxes have multiple selections, or the order values
//   were picked in. Without this, stale selections could survive in one box
//   while making every other box show "no matching values" with no way to
//   recover except clearing the whole form.
// - A single "Clear all" control resets every facet in the group to
//   unchecked at once, applied immediately (not deferred).

function uniqueSorted(rows, key) {
  const set = new Set();
  for (const r of rows) {
    const v = r[key];
    if (v !== null && v !== undefined && String(v).trim() !== "") set.add(String(v));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function createFacetFilterGroup({ container, rows, facets, initialSelections = {}, onChange }) {
  // committed = actually-applied selections, drives cross-facet pruning and
  // getSelections(). pending = checkbox state within a box not yet applied -
  // always re-synced from committed whenever any commit happens anywhere in
  // the group, so it never carries stale state across an unrelated commit.
  const committed = {};
  const pending = {};
  for (const f of facets) {
    committed[f.key] = new Set(initialSelections[f.key] || []);
    pending[f.key] = new Set(committed[f.key]);
  }
  const searchTerms = {};
  for (const f of facets) searchTerms[f.key] = "";

  function rowsMatchingExcept(excludeKey) {
    return rows.filter((r) =>
      facets.every((f) => {
        if (f.key === excludeKey) return true;
        const sel = committed[f.key];
        if (!sel || sel.size === 0) return true;
        return sel.has(String(r[f.key] ?? ""));
      })
    );
  }

  function matchingRows() {
    return rowsMatchingExcept(null);
  }

  // Prune every facet's committed selections down to values still reachable
  // given every other facet's current committed selections, repeating until
  // nothing changes - pruning one facet can invalidate another, so a single
  // pass isn't enough.
  function pruneToFixedPoint() {
    let changed = true;
    let guard = 0;
    while (changed && guard < facets.length + 5) {
      changed = false;
      guard++;
      for (const f of facets) {
        if (committed[f.key].size === 0) continue;
        const valid = new Set(uniqueSorted(rowsMatchingExcept(f.key), f.key));
        for (const v of [...committed[f.key]]) {
          if (!valid.has(v)) {
            committed[f.key].delete(v);
            changed = true;
          }
        }
      }
    }
  }

  function resetPendingToCommitted() {
    for (const f of facets) pending[f.key] = new Set(committed[f.key]);
  }

  function commitFacet(f) {
    committed[f.key] = new Set(pending[f.key]);
    pruneToFixedPoint();
    resetPendingToCommitted();
    render();
    onChange && onChange(getSelections(), matchingRows());
  }

  function clearAll() {
    for (const f of facets) {
      committed[f.key] = new Set();
      pending[f.key] = new Set();
    }
    render();
    onChange && onChange(getSelections(), matchingRows());
  }

  function render() {
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "facet-group-head";
    const clearAllBtn = document.createElement("button");
    clearAllBtn.type = "button";
    clearAllBtn.className = "btn ghost small";
    clearAllBtn.textContent = "Clear all";
    clearAllBtn.addEventListener("click", clearAll);
    header.appendChild(clearAllBtn);
    container.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "facet-grid";
    for (const f of facets) {
      const box = document.createElement("div");
      box.className = "facet-box";

      const label = document.createElement("div");
      label.className = "facet-label";
      label.innerHTML = `<span>${f.label}${f.required ? ' <span class="req">*</span>' : ""}</span><span style="font-weight:400;color:var(--muted)">${committed[f.key].size || ""}</span>`;
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

      const filterBtn = document.createElement("button");
      filterBtn.type = "button";
      filterBtn.className = "btn primary small facet-filter-btn";
      filterBtn.textContent = "Filter";
      filterBtn.addEventListener("click", () => commitFacet(f));
      box.appendChild(filterBtn);

      grid.appendChild(box);
    }
    container.appendChild(grid);
  }

  function renderOptionsFor(f, optionsDiv) {
    optionsDiv.innerHTML = "";
    // Available options reflect what every OTHER box currently has committed
    // (unchanged) - but each checkbox's checked-state reflects this box's own
    // PENDING selection, not yet applied until Filter is clicked.
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
      cb.checked = pending[f.key].has(value);
      cb.addEventListener("change", () => {
        if (cb.checked) pending[f.key].add(value);
        else pending[f.key].delete(value);
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
    for (const f of facets) out[f.key] = [...committed[f.key]];
    return out;
  }

  pruneToFixedPoint(); // in case initialSelections came in already inconsistent (e.g. reopening a draft)
  resetPendingToCommitted();
  render();
  return { getSelections, getMatchingRows: matchingRows, rerender: render };
}
