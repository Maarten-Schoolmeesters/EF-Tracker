// Custom dropdown: shows each option's label plus a lighter-gray description
// next to it. A native <select> can't style part of an option's text
// differently, so this replaces it for fields that need that.

export function createStyledDropdown({ container, options, value, placeholder, required, disabled, onChange }) {
  let selected = value || "";
  let open = false;

  function currentOption() {
    return options.find((o) => o.value === selected) || null;
  }

  function render() {
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "styled-dropdown" + (disabled ? " disabled" : "");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "styled-dropdown-btn";
    btn.disabled = !!disabled;
    const cur = currentOption();
    btn.innerHTML = `
      <span class="${cur ? "" : "placeholder"}">${cur ? cur.label : (placeholder || "Select…")}</span>
      <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    `;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (disabled) return;
      open = !open;
      render();
    });
    wrap.appendChild(btn);

    if (open) {
      const panel = document.createElement("div");
      panel.className = "styled-dropdown-panel";
      if (!required) {
        const clearRow = document.createElement("div");
        clearRow.className = "styled-dropdown-option";
        clearRow.innerHTML = `<span class="opt-label placeholder">${placeholder || "Select…"}</span>`;
        clearRow.addEventListener("click", () => choose(""));
        panel.appendChild(clearRow);
      }
      options.forEach((o) => {
        const row = document.createElement("div");
        row.className = "styled-dropdown-option" + (o.value === selected ? " active" : "");
        row.innerHTML = `<span class="opt-label">${o.label}</span>${o.description ? `<span class="opt-desc">${o.description}</span>` : ""}`;
        row.addEventListener("click", () => choose(o.value));
        panel.appendChild(row);
      });
      wrap.appendChild(panel);
    }

    container.appendChild(wrap);
  }

  function choose(v) {
    selected = v;
    open = false;
    render();
    onChange && onChange(selected);
  }

  function outsideClick(e) {
    if (open && !container.contains(e.target)) {
      open = false;
      render();
    }
  }
  document.addEventListener("click", outsideClick);

  render();
  return {
    getValue: () => selected,
    setValue: (v) => { selected = v; render(); },
    setDisabled: (d) => { disabled = d; render(); },
    destroy: () => document.removeEventListener("click", outsideClick),
  };
}
