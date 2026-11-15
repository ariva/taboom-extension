// Shared DOM helpers for extension pages (side panel, options). Kept out of
// core.ts so that file stays DOM-free and unit-testable under plain node.

// document.getElementById for ids the page's static markup guarantees. Typed as a
// form control by default — covers .value/.checked/.disabled on the inputs and
// buttons these pages look up; pass T for anything else (select, template, …).
// `as`: the id → element type pairing lives in the HTML, which TS cannot see.
export const getElementById = <T extends HTMLElement = HTMLInputElement>(id: string) =>
  document.getElementById(id) as T;

// event.target → nearest ancestor matching `selector`, or null. Replaces the
// cast-then-closest idiom: event targets are EventTarget, not Element.
// Duck-typed, not instanceof: a target can come from another realm (iframe, test DOM).
export function closest<T extends Element = HTMLElement>(target: EventTarget | null, selector: string): T | null {
  return target && "closest" in target ? (target as Element).closest<T>(selector) : null;
}

// querySelector for nodes the page cannot work without (static markup, templates):
// a readable error at the lookup instead of "cannot read properties of null" later
export function mustQuery<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) {
    throw new Error(`missing element: ${selector}`);
  }
  return found;
}

// SVG markup into a host — a whole <svg> into a button, or shapes into an existing <svg> — through
// the XML parser instead of innerHTML: AMO's validator flags every innerHTML assignment whose
// right-hand side is not a literal (ours are constants, but a ternary or an imported constant is
// not a literal to it), and the parser route costs the same for an icon
export function setSvgMarkup(host: Element, markup: string): void {
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    "image/svg+xml",
  );
  host.replaceChildren(...Array.from(parsed.documentElement.childNodes, (node) => document.importNode(node, true)));
}

// fold/unfold-all glyphs shared by the sidepanel toolbar and the options
// What's-new toggle — double chevrons pointing toward/away from collapse
export const FOLD_ICONS = {
  fold: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3l4 4 4-4M4 9l4 4 4-4"/></svg>',
  unfold:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l4-4 4 4M4 13l4-4 4 4"/></svg>',
};
