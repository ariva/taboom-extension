// The custom hover tip of the tab list: group headers and rows carry data-tip, this
// module shows it beside the pointer.
import { closest } from "../../../lib/dom.ts";
import { listEl } from "../foundation/elements.ts";
import { fuzzyActive, highlightRanges } from "../model/index.ts";
import type { Badge, TipTag } from "../model/index.ts";
import { setTextWithMarks } from "./row.ts";
import { state } from "../foundation/state.ts";

// Custom hover tip for group headers, offset right+below the pointer so the
// cursor never covers the text (native title tooltips can't be positioned).
const hoverTip = document.createElement("div");
hoverTip.id = "hover-tip";
hoverTip.hidden = true;
document.body.append(hoverTip);

function moveHoverTip(event: MouseEvent): void {
  hoverTip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - hoverTip.offsetWidth - 4)}px`;
  hoverTip.style.top = `${Math.min(event.clientY + 18, window.innerHeight - hoverTip.offsetHeight - 4)}px`;
}

listEl.addEventListener("mouseover", (event) => {
  const target = event.target;
  // buttons/checkboxes carry their own native tooltips — don't stack ours on top
  const carrier = closest(target, "button, input") ? null : closest(target, ".group-header, .tabgroup-header, .row");
  if (!carrier?.dataset.tip) {
    hoverTip.hidden = true;
    return;
  }
  const tip = carrier.dataset.tip;
  // row tip = the URL and the states line — while searching, mark the matched tokens in it too
  if (carrier.classList.contains("row") && state.query.trim()) {
    const tokens = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    setTextWithMarks(hoverTip, tip, highlightRanges(tip, tokens, fuzzyActive(state)));
  } else {
    hoverTip.textContent = tip;
  }
  // a row's states as the same badges it shows (protected / kept alive green, snoozed amber, pinned grey)
  if (carrier.dataset.tipBadges) {
    const badges: Badge[] = JSON.parse(carrier.dataset.tipBadges); // written by row.ts from the view model
    const line = document.createElement("div");
    line.className = "tip-states";
    for (const [label, kind] of badges) {
      const badge = document.createElement("span");
      badge.className = kind ? `badge ${kind}` : "badge";
      badge.textContent = label;
      line.append(badge);
    }
    hoverTip.append(line);
  }
  // a row with tags: a last line of colored pills, like the badges
  if (carrier.dataset.tipTags) {
    const tags: TipTag[] = JSON.parse(carrier.dataset.tipTags); // written by row.ts from the view model
    const line = document.createElement("div");
    line.className = "tip-tags";
    line.append("Tags: ");
    for (const tag of tags) {
      const pill = document.createElement("span");
      pill.className = tag.dark ? "badge tag dark" : "badge tag";
      pill.style.background = tag.color;
      const text = document.createElement("span"); // same markup as the row's pills
      text.textContent = tag.name;
      pill.append(text);
      line.append(pill);
    }
    hoverTip.append(line);
  }
  hoverTip.hidden = false;
  moveHoverTip(event);
});
listEl.addEventListener("mousemove", (event) => {
  if (!hoverTip.hidden) {
    moveHoverTip(event);
  }
});
listEl.addEventListener("mouseleave", () => (hoverTip.hidden = true));
listEl.addEventListener("scroll", () => (hoverTip.hidden = true), { passive: true });

// clicks and menus change what the tip would say — callers hide it, rehover shows fresh
export function hideHoverTip(): void {
  hoverTip.hidden = true;
}
