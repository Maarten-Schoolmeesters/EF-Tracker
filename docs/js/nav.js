// Tiny indirection so page modules can trigger navigation without importing
// main.js directly (which would create a circular import, since main.js
// imports the page modules).
let pageChangeHandler = null;

export function registerPageChangeHandler(fn) {
  pageChangeHandler = fn;
}

export function goToPage(pageKey) {
  if (pageChangeHandler) pageChangeHandler(pageKey);
}
