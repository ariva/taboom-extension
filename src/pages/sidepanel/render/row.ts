// One tab row: clones #row-template and fills it from the row view-model; plus the
// two small DOM helpers rows share with other surfaces (marked text, favicon image).
import { getElementById, mustQuery } from "../../../lib/dom.ts";
import { faviconUrl } from "../../../lib/platform/favicon.ts";
import { tabGroupColor } from "../model/index.ts";
import type { HighlightRange, RowViewModel } from "../model/index.ts";
import { perfMeasure, perfOn } from "../foundation/perf.ts";
import { effectiveSort, state, tabGroupsActive } from "../foundation/state.ts";

type Tab = chrome.tabs.Tab;

// translate a row view-model into DOM; wires event handlers to actions
export function renderRow(tab: Tab, vm: RowViewModel): HTMLElement {
  if (!perfOn()) {
    return renderRowImpl(tab, vm); // skip the per-row closure allocation
  }
  return perfMeasure("sidepanel.renderRow", () => renderRowImpl(tab, vm));
}

// cloneNode of the #row-template skeleton beats ~10 createElement calls plus
// per-button innerHTML SVG parsing on every row of every render
const ROW_TEMPLATE = getElementById<HTMLTemplateElement>("row-template");

// text with the model's highlight ranges wrapped in <mark> (plain textContent
// when there is nothing to mark — the common non-search path stays cheap)
export function setTextWithMarks(el: Element, text: string, ranges: HighlightRange[] | undefined): void {
  if (!ranges || ranges.length === 0) {
    el.textContent = text;
    return;
  }
  el.textContent = "";
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start > pos) {
      el.append(text.slice(pos, start));
    }
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    el.append(mark);
    pos = end;
  }
  if (pos < text.length) {
    el.append(text.slice(pos));
  }
}

function renderRowImpl(tab: Tab, vm: RowViewModel): HTMLElement {
  // static markup: #row-template holds exactly the row skeleton (cloneNode types as Node)
  const row = ROW_TEMPLATE.content.firstElementChild!.cloneNode(true) as HTMLElement;
  row.className = vm.classes.join(" ");
  row.style.viewTransitionName = vm.viewTransitionName;
  row.dataset.tabId = String(tab.id);
  row.draggable = true; // drag onto another window's rows/header to move
  if (tab.url) {
    row.dataset.tip = tab.url; // full URL in the hover tip (titles ellipsize)
  }

  mustQuery<HTMLInputElement>(row, "input").checked = vm.checked;

  const dot = mustQuery(row, ".win-dot");
  if (vm.dot) {
    if (vm.dot.color) {
      dot.style.background = vm.dot.color;
    } else {
      dot.classList.add("current");
    }
    dot.title = vm.dot.title;
    // active-tab left bar picks this up ("" = current window → accent fallback)
    if (vm.dot.color) {
      row.style.setProperty("--win-color", vm.dot.color);
    }
  } else {
    dot.remove();
  }

  const favicon = mustQuery(row, ".favicon");
  // grouped rows carry a small square in the group's color. Placement per view:
  // window view — leftmost + indent (nested under the sub-header's square);
  // Tab groups sort — none (the rows already sit under their group header);
  // every other sort — after the window dot: checkbox, dot, square, text.
  const sortNow = effectiveSort();
  if (tabGroupsActive() && (tab.groupId ?? -1) !== -1 && sortNow !== "group-tabgroup") {
    const group = state.tabGroups.get(tab.groupId);
    const square = document.createElement("span");
    square.className = "tg-square";
    // a vanished group has no color → the grey fallback
    square.style.background = tabGroupColor(group?.color) ?? "#5f6368";
    square.title = `Group "${group?.title || "(unnamed group)"}"`;
    if (sortNow === "window") {
      row.prepend(square);
      row.classList.add("in-group");
    } else if (vm.dot) {
      dot.after(square);
    } else {
      favicon.before(square); // the window dot was removed above
    }
  }
  if ("pageUrl" in vm.favicon) {
    favicon.append(faviconImg(vm.favicon.pageUrl));
  } else {
    favicon.textContent = vm.favicon.letter;
  }

  setTextWithMarks(mustQuery(row, ".title"), vm.title, vm.titleRanges);
  setTextWithMarks(mustQuery(row, ".host"), vm.host, vm.hostRanges);
  const meta = mustQuery(row, ".meta");
  if (vm.age) {
    const age = document.createElement("span");
    age.textContent = vm.age;
    meta.append(age);
  }
  for (const [label, kind] of vm.badges) {
    const badge = document.createElement("span");
    badge.className = kind ? `badge ${kind}` : "badge";
    badge.textContent = label;
    meta.append(badge);
  }

  if (!vm.canSnooze) {
    mustQuery(row, '[data-action="snooze"]').remove();
  }
  // template ships both protect variants; drop the one this row doesn't need
  mustQuery(row, vm.protected ? '[data-icon="protect"]' : '[data-icon="unprotect"]').remove();
  const protect = mustQuery(row, '[data-action="toggle-protect"]');
  protect.title = protect.ariaLabel = vm.protectLabel;
  return row;
}

// Chrome's local favicon cache — no network request to the site
export function faviconImg(pageUrl: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = faviconUrl(pageUrl, 16);
  img.loading = "lazy"; // don't fetch favicons for offscreen rows up front
  img.width = img.height = 16;
  img.addEventListener("error", () => img.remove());
  return img;
}
