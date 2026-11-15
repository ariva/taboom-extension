// src/lib/dom.ts — SVG markup goes through the XML parser, never innerHTML (AMO's linter flags every
// non-literal innerHTML assignment; the markup is constant, the parser route is as fast for an icon).
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { test } from "vitest";
import { FOLD_ICONS, setSvgMarkup } from "../../src/lib/dom.ts";

const window = new Window();
Object.assign(globalThis, { document: window.document, DOMParser: window.DOMParser });

test("Lib - DOM - setSvgMarkup puts a whole <svg> into a host and swaps it on the next call", () => {
  const button = window.document.createElement("button");
  setSvgMarkup(button as unknown as Element, FOLD_ICONS.fold);
  assert.equal(button.children.length, 1);
  assert.equal(button.firstElementChild?.tagName.toLowerCase(), "svg");
  assert.equal(button.querySelector("path")?.getAttribute("d"), "M4 3l4 4 4-4M4 9l4 4 4-4");
  setSvgMarkup(button as unknown as Element, FOLD_ICONS.unfold);
  assert.equal(button.children.length, 1, "replaced, not appended");
  assert.equal(button.querySelector("path")?.getAttribute("d"), "M4 7l4-4 4 4M4 13l4-4 4 4");
});

test("Lib - DOM - setSvgMarkup fills an existing <svg> with shape markup", () => {
  const svg = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
  setSvgMarkup(svg as unknown as Element, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/>');
  assert.deepEqual(
    [...svg.children].map((child) => child.tagName.toLowerCase()),
    ["rect", "path"],
  );
  assert.equal(svg.children[0]?.namespaceURI, "http://www.w3.org/2000/svg", "SVG namespace, so it renders");
});
