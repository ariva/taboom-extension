// Shared DOM helpers for extension pages (side panel, options). Kept out of
// core.js so that file stays DOM-free and unit-testable under plain node.

// document.getElementById typed as a form control — covers .value/.checked/
// .disabled on the inputs, selects, and buttons these pages look up.
export const getElementById = (id) =>
  /** @type {HTMLInputElement} */ (document.getElementById(id));
