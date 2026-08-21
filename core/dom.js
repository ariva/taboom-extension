// Shared DOM helpers for extension pages (side panel, options). Kept out of
// core.js so that file stays DOM-free and unit-testable under plain node.

// document.getElementById typed as a form control — covers .value/.checked/
// .disabled on the inputs, selects, and buttons these pages look up.
export const getElementById = (id) =>
  /** @type {HTMLInputElement} */ (document.getElementById(id));

// fold/unfold-all glyphs shared by the sidepanel toolbar and the options
// What's-new toggle — double chevrons pointing toward/away from collapse
export const FOLD_ICONS = {
  fold: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3l4 4 4-4M4 9l4 4 4-4"/></svg>',
  unfold: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l4-4 4 4M4 13l4-4 4 4"/></svg>',
};
