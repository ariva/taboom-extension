// Reveal scrolling for the current row. "start" (opening the panel, a tab switch outside it,
// a view change): the row — or the Split / tab-group sub-header it sits under — at the top
// of the list. "nearest" (a row activated from the list): the minimal scroll that shows the
// row, or its whole block when that fits: a block below scrolls up until its last row meets
// the bottom edge, a block above scrolls down until its header meets the top edge. The measures are
// placeholder sizes for off-screen rows (content-visibility: auto); they are exact because
// every row has the same height (sidepanel.css, .row .meta min-height).
import { listEl } from "../foundation/elements.ts";

interface Block {
  header: HTMLElement;
  last: HTMLElement;
}

// the outermost block the row belongs to: a split inside a tab-group run reveals the group
function blockOf(row: HTMLElement): Block | null {
  const inGroup = row.classList.contains("in-group");
  if (!inGroup && !row.classList.contains("in-split")) {
    return null;
  }
  const headerSelector = inGroup ? ".tabgroup-header:not(.split-header)" : ".split-header";
  // what the block's run is made of (a group run also holds its nested split headers)
  const member = (el: Element): boolean =>
    inGroup ? el.matches(".row.in-group, .split-header.nested") : el.matches(".row.in-split");
  let header: Element | null = row.previousElementSibling;
  while (header && member(header)) {
    header = header.previousElementSibling;
  }
  if (!(header instanceof HTMLElement) || !header.matches(headerSelector)) {
    return null;
  }
  let last: HTMLElement = row;
  for (let next = row.nextElementSibling; next instanceof HTMLElement && member(next); next = next.nextElementSibling) {
    last = next;
  }
  return { header, last };
}

// a row flush against the bottom edge reads as cut off: keep this much list under it
const BOTTOM_ROOM = 20;

// the minimal scroll that shows everything from `first` to `last` (a block, or one row):
// from below, `last` stops BOTTOM_ROOM above the bottom edge; from above, `first` meets the top edge
function scrollSpanIntoView(first: HTMLElement, last: HTMLElement, margin: number): void {
  if (listEl.clientHeight === 0) {
    return; // nothing laid out, nothing to align
  }
  const view = listEl.getBoundingClientRect();
  const top = first.getBoundingClientRect().top - margin;
  const bottom = last.getBoundingClientRect().bottom + BOTTOM_ROOM;
  if (top < view.top) {
    listEl.scrollTop += top - view.top;
  } else if (bottom > view.bottom) {
    listEl.scrollTop += bottom - view.bottom;
  }
}

// "start": the row — or its block's header — at the top of the list, as far as the scroll range
// allows (a tab switch, the panel opening, a view change). "nearest": the minimal scroll (a row
// activated from the list: the list must not jump under the click)
export function revealRow(row: HTMLElement, align: "nearest" | "start" = "nearest"): void {
  // the rows' scroll-margin-top keeps a sticky window header clear; a block's header needs it too
  const margin = Number.parseFloat(window.getComputedStyle(row).scrollMarginTop) || 0;
  // no viewport to align against (the panel not laid out — happy-dom, a hidden page): the browser's own scroll
  if (listEl.clientHeight === 0) {
    row.scrollIntoView({ block: align });
    return;
  }
  const block = blockOf(row);
  if (align === "start") {
    const first = block ? block.header : row;
    listEl.scrollTop += first.getBoundingClientRect().top - margin - listEl.getBoundingClientRect().top;
    return;
  }
  if (!block) {
    scrollSpanIntoView(row, row, margin);
    return;
  }
  const top = block.header.getBoundingClientRect().top - margin;
  const bottom = block.last.getBoundingClientRect().bottom;
  if (bottom - top <= listEl.clientHeight) {
    scrollSpanIntoView(block.header, block.last, margin);
    return;
  }
  // taller than the viewport: the row itself, then its header when that keeps the row on screen
  row.scrollIntoView({ block: "nearest" });
  const view = listEl.getBoundingClientRect();
  const headerTop = block.header.getBoundingClientRect().top - margin;
  if (headerTop < view.top && row.getBoundingClientRect().bottom - headerTop <= listEl.clientHeight) {
    listEl.scrollTop += headerTop - view.top;
  }
}
