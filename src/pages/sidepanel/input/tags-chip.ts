// The Tags chip's picker (#tags-pop): one tick per tag with its count; ticks narrow the
// tags filter (OR), none = any tagged tab. The chip itself is a filter button — the shared
// filter-bar click handler switches to it, this module opens the picker under it.
import { orderedTags, tagColorHex } from "../../../app/tags.ts";
import { closest, getElementById } from "../../../lib/dom.ts";
import { filterBar } from "../foundation/elements.ts";
import { countsByFilter, searchCandidates } from "../model/index.ts";
import { render } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";

const pop = getElementById("tags-pop");

// focus left for the page or another window: close like the context menu does
window.addEventListener("blur", () => pop.hidePopover?.());

function pickerOpen(): boolean {
  try {
    return pop.matches(":popover-open");
  } catch {
    return false; // happy-dom: selector unsupported
  }
}

function fillPicker(): void {
  pop.textContent = "";
  const tags = orderedTags(state.tags, state.tagPages, state.ui); // Settings → Tags order in pickers
  if (tags.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted tag-pick-empty";
    empty.textContent = "No tags yet — tag a tab from its row menu (Tags ▸).";
    pop.append(empty);
    return;
  }
  // per-tag counts over what the search left (like the chips' own counts)
  const counted = state.query ? searchCandidates(state.allTabs, state) : state.allTabs;
  for (const tag of tags) {
    const label = document.createElement("label");
    label.className = "tag-pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = state.tagFilter.has(tag.id);
    box.addEventListener("change", () => {
      if (box.checked) {
        state.tagFilter.add(tag.id);
      } else {
        state.tagFilter.delete(tag.id);
      }
      render(false);
      fillPicker(); // the counts and the Clear link follow
    });
    const dot = document.createElement("span");
    dot.className = "win-dot";
    dot.style.background = tagColorHex(tag.color);
    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = tag.name;
    const count = document.createElement("span");
    count.className = "tag-pick-count muted";
    count.textContent = String(countsByFilter(counted, state.derived, new Set([tag.id])).tags);
    label.append(box, dot, name, count);
    pop.append(label);
  }
  if (state.tagFilter.size > 0) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "tag-pick-clear";
    clear.textContent = "Reset selection";
    clear.addEventListener("click", () => {
      state.tagFilter.clear();
      render(false);
      fillPicker();
    });
    pop.append(clear);
  }
}

// renders happen on every tab / storage event — keep an open picker current
export function refillTagsPickerIfOpen(): void {
  if (pickerOpen()) {
    fillPicker();
  }
}

export function initTagsChip(): void {
  const chip = filterBar.querySelector<HTMLElement>('button[data-filter="tags"]');
  if (!chip) {
    return;
  }
  // a press on the chip while the picker is open: the light dismiss closes it on pointerdown,
  // and the click that follows must not reopen it — a second click toggles, like Esc
  let closedByThisPress = false;
  filterBar.addEventListener("pointerdown", (event) => {
    closedByThisPress = pickerOpen() && closest(event.target, 'button[data-filter="tags"]') !== null;
  });
  // after the filter-bar handler (same element, registration order): the filter is set, the list rendered
  filterBar.addEventListener("click", (event) => {
    if (!closest(event.target, 'button[data-filter="tags"]')) {
      return;
    }
    if (closedByThisPress) {
      closedByThisPress = false;
      return;
    }
    fillPicker();
    if (!pickerOpen()) {
      pop.showPopover?.(); // a second click while open would throw (the light dismiss already closed it)
    }
    // under the chip, left-aligned with it — pulled left when it would run past the panel's edge
    // (measured after the show: a hidden popover has no width)
    const anchor = chip.getBoundingClientRect();
    pop.style.top = `${anchor.bottom + 4}px`;
    pop.style.left = `${Math.max(4, Math.min(anchor.left, window.innerWidth - pop.offsetWidth - 4))}px`;
  });
}
