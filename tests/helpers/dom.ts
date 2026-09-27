// Typed DOM lookups for tests: a missing node fails the test with a readable message
// instead of "cannot read properties of null", and the result needs no cast or `!`.
export function q<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) {
    throw new Error(`test DOM: nothing matches ${selector}`);
  }
  return found;
}

export function qa<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

// document.getElementById, typed and required
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`test DOM: no element with id ${id}`);
  }
  return found as T; // caller names the element type it expects, like querySelector<T>
}
