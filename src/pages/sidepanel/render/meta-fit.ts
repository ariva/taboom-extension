// Measures what fitTagPills (model/rows.ts) needs: the meta line's width and the width of a
// label in the badge font. Text is measured on a canvas — no layout per label — and cached by
// font; the line width is read from the first rendered row after each render, like --row-h.
import { listEl } from "../foundation/elements.ts";
import type { PillFit } from "../model/index.ts";

const context = document.createElement("canvas").getContext("2d"); // null in happy-dom: no fit there
const widths = new Map<string, number>();
let font = "";
let lineWidth = 0;
let nestedLineWidth = 0;
let rem = 16;

function textWidth(label: string): number {
  const cached = widths.get(label);
  if (cached !== undefined) {
    return cached;
  }
  // `context` is checked by pillFit before any measuring
  const width = context ? context.measureText(label).width : 0;
  widths.set(label, width);
  return width;
}

export function pillFit(nested: boolean): PillFit | undefined {
  const line = nested ? nestedLineWidth : lineWidth;
  if (!context || line <= 0) {
    return undefined;
  }
  return { line, rem, textWidth };
}

// the meta's left edge to the row content's right edge: the action buttons share the line and
// their number differs per row (the fit subtracts them), the meta alone would be one row's width
function lineOf(row: HTMLElement, meta: HTMLElement): number {
  const end = row.querySelector(".actions") ?? meta;
  return end.getBoundingClientRect().right - meta.getBoundingClientRect().left;
}

// After a render: read the line widths and the badge font from the DOM. True when they changed
// since the last render — the caller renders once more with the right fit (same task: no flash).
export function syncMetaFit(): boolean {
  if (!context) {
    return false;
  }
  const row = listEl.querySelector<HTMLElement>(".row");
  const meta = row?.querySelector<HTMLElement>(".meta");
  if (!row || !meta) {
    return false;
  }
  row.style.contentVisibility = "visible"; // may be offscreen: force real layout to measure
  const width = lineOf(row, meta);
  const nestedRow = listEl.querySelector<HTMLElement>(".row.in-group");
  const nestedMeta = nestedRow?.querySelector<HTMLElement>(".meta");
  const nextRem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  // an indented row's line is 2rem narrower (.row.in-group padding-left) when none is rendered to measure
  const nestedWidth = nestedRow && nestedMeta ? lineOf(nestedRow, nestedMeta) : width - 2 * nextRem;
  // the badge font: the meta's family and weight at .badge's size (the probe keeps the CSS the source)
  const probe = document.createElement("span");
  probe.className = "badge";
  meta.append(probe);
  const style = getComputedStyle(probe);
  const nextFont = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  probe.remove();
  row.style.contentVisibility = "";
  const changed = width !== lineWidth || nestedWidth !== nestedLineWidth || nextFont !== font || nextRem !== rem;
  lineWidth = width;
  nestedLineWidth = nestedWidth;
  rem = nextRem;
  if (nextFont !== font) {
    font = nextFont;
    context.font = font;
    widths.clear();
  }
  return changed;
}

// the panel's width changes the line: remeasure and re-render once (happy-dom has no ResizeObserver)
export function initMetaFit(rerender: () => void): void {
  if (typeof ResizeObserver === "undefined") {
    return;
  }
  new ResizeObserver(() => {
    if (syncMetaFit()) {
      rerender();
    }
  }).observe(listEl);
}
