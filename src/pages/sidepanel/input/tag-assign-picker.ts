// The row menu's Tags… picker (#tag-assign-pop): one checkbox per tag for the clicked row (or the
// selection) — the same checklist as Settings → Tagged pages, so ticking several needs no
// re-opening — plus New tag… at the bottom. Renders refill it while open.
import { hasTagEverywhere, orderedTags, tagColorHex } from "../../../app/tags.ts";
import { state } from "../foundation/state.ts";
import { newTagForTabs, tagPageUrls, toggleTag } from "../ops/tag-ops.ts";

const pop = document.createElement("div");
pop.id = "tag-assign-pop";
pop.setAttribute("popover", ""); // auto: light dismiss closes it, like the chip's picker
document.body.append(pop);

let pickerIds: number[] | null = null; // the rows the open picker edits; null = closed

function pickerOpen(): boolean {
  try {
    return pop.matches(":popover-open");
  } catch {
    return false; // happy-dom: selector unsupported
  }
}

// focus left for the page or another window: close like the context menu does (the light
// dismiss only sees pointer events inside this document)
window.addEventListener("blur", () => pop.hidePopover?.());

pop.addEventListener("toggle", (event) => {
  if ((event as ToggleEvent).newState === "closed") {
    pickerIds = null;
  }
});

function fill(ids: number[]): void {
  pop.textContent = "";
  const urls = tagPageUrls(ids);
  const tags = orderedTags(state.tags, state.tagPages, state.ui); // Settings → Tags order in pickers
  // header like the context menu's: a title and the corner ✕ (closes the picker, the menu stays)
  const head = document.createElement("div");
  head.className = "tag-pick-head";
  const title = document.createElement("span");
  title.className = "tag-pick-title muted";
  title.textContent = ids.length > 1 ? `Tags for ${ids.length} tabs` : "Tags";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "tag-pick-close";
  close.title = close.ariaLabel = "Close";
  close.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>'; // constant markup
  close.addEventListener("click", () => pop.hidePopover?.());
  head.append(title, close);
  pop.append(head);
  if (tags.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted tag-pick-empty";
    empty.textContent = "No tags yet.";
    pop.append(empty);
  }
  for (const tag of tags) {
    const label = document.createElement("label");
    label.className = "tag-pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = hasTagEverywhere(state.tagPages, urls, tag.id); // ✓ only when every target carries it
    box.addEventListener("change", () => toggleTag(ids, tag.id, box.checked)); // the refresh refills the picker
    const dot = document.createElement("span");
    dot.className = "win-dot";
    dot.style.background = tagColorHex(tag.color);
    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = tag.name;
    label.append(box, dot, name);
    pop.append(label);
  }
  const divider = document.createElement("div");
  divider.className = "tag-pick-divider";
  pop.append(divider);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "tag-new";
  add.textContent = "New tag…";
  add.addEventListener("click", () => {
    pop.hidePopover?.(); // the dialog takes over
    newTagForTabs(ids); // the dialog names it, the new tag lands on these rows
  });
  pop.append(add);
}

// at: the menu item's click — the picker opens there, kept inside the panel
export function openTagAssignPicker(at: Pick<MouseEvent, "clientX" | "clientY">, ids: number[]): void {
  pickerIds = ids;
  fill(ids);
  if (!pickerOpen()) {
    pop.showPopover?.();
  }
  // measured after the show: a hidden popover has no size
  pop.style.left = `${Math.max(4, Math.min(at.clientX, window.innerWidth - pop.offsetWidth - 4))}px`;
  pop.style.top = `${Math.max(4, Math.min(at.clientY, window.innerHeight - pop.offsetHeight - 4))}px`;
}

// renders happen on every tab / storage event — keep an open picker current (its rows may be gone)
export function refillTagAssignPickerIfOpen(): void {
  if (pickerIds !== null && pickerOpen()) {
    const live = new Set(state.allTabs.map((tab) => tab.id));
    const ids = pickerIds.filter((id) => live.has(id));
    if (ids.length === 0) {
      pop.hidePopover?.();
      return;
    }
    fill(ids);
  }
}
