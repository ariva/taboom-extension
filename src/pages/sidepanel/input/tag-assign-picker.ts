// The row menu's Tags… picker (#tag-assign-pop): one checkbox per tag for the clicked row (or the
// selection), ticks staged until Apply — Cancel, ✕, Esc and a click outside drop them. Renders
// refill it while open without losing the staged ticks. New tag… is the row menu's own item.
import { toggleTagOnPages } from "../../../app/storage.ts";
import { hasTagEverywhere, orderedTags, tagColorHex } from "../../../app/tags.ts";
import { askDialog } from "../../../lib/ui/ask-dialog.ts";
import { refresh } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";
import { tagPageUrls } from "../ops/tag-ops.ts";

const pop = document.createElement("div");
pop.id = "tag-assign-pop";
pop.setAttribute("popover", ""); // auto: light dismiss closes it, like the chip's picker
document.body.append(pop);

let pickerIds: number[] | null = null; // the rows the open picker edits; null = closed
let reopenMenu: (() => void) | null = null; // Cancel / ✕ bring the row menu back where it was
const staged = new Map<string, boolean>(); // tag id → wanted state, only where it differs from stored
let applyButton: HTMLButtonElement | null = null; // live only while there is something to apply
let openedAt: Pick<MouseEvent, "clientX" | "clientY"> | null = null; // where the picker sits — the question opens there too
// how the picker is closing: Apply / Cancel / ✕ / Esc / blur say so first; a light dismiss (a click
// outside) leaves it null — the one case that asks about unsaved ticks
let closingBy: "apply" | "cancel" | "escape" | "blur" | null = null;

function pickerOpen(): boolean {
  try {
    return pop.matches(":popover-open");
  } catch {
    return false; // happy-dom: selector unsupported
  }
}

// focus left for the page or another window: close like the context menu does (the light
// dismiss only sees pointer events inside this document)
window.addEventListener("blur", () => {
  if (pickerOpen()) {
    closingBy = "blur";
    pop.hidePopover?.();
  }
});
// Esc is a light dismiss too — noted here so the close does not ask about the ticks
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape" && pickerOpen()) {
      closingBy = "escape";
    }
  },
  true,
);
// Enter applies, like OK in a dialog
pop.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && pickerIds && staged.size > 0) {
    event.preventDefault();
    applyStaged(pickerIds);
  }
});

pop.addEventListener("toggle", (event) => {
  // the page under the picker is dimmed and deaf to hover (sidepanel.css: body.tag-picking) — a
  // popover's backdrop does not take pointer events, so the class does it
  document.body.classList.toggle("tag-picking", (event as ToggleEvent).newState === "open");
  if ((event as ToggleEvent).newState !== "closed") {
    return;
  }
  const ids = pickerIds;
  const changes = [...staged];
  const by = closingBy;
  pickerIds = null;
  staged.clear();
  closingBy = null;
  // a click outside with ticks pending: ask, in the panel's own dialog (Cancel / ✕ / Esc / blur do not)
  if (by === null && ids && changes.length > 0) {
    askDialog({
      message: `Apply the tag change${changes.length === 1 ? "" : "s"}?`,
      okLabel: "Apply",
      cancelLabel: "Discard",
      near: openedAt, // where the picker was, not under the toolbar
    }).then((ok) => {
      if (ok === true) {
        writeChanges(ids, changes);
      }
    });
  }
});

async function writeChanges(ids: number[], changes: [string, boolean][]): Promise<void> {
  const urls = tagPageUrls(ids);
  for (const [tagId, on] of changes) {
    await toggleTagOnPages(urls, tagId, on);
  }
  if (changes.length > 0) {
    refresh(true);
  }
}

// Apply: one storage write per changed tag, then the refresh redraws badges
function applyStaged(ids: number[]): Promise<void> {
  const changes = [...staged];
  staged.clear();
  closingBy = "apply";
  pop.hidePopover?.();
  return writeChanges(ids, changes);
}

function syncApply(): void {
  if (applyButton) {
    applyButton.disabled = staged.size === 0; // nothing changed = nothing to apply
  }
}

// Cancel / ✕: the staged ticks go (closed handler), the row menu comes back where it was
function cancel(event: Event): void {
  event.stopPropagation(); // the menu's document click-away must not close the menu we bring back
  closingBy = "cancel";
  pop.hidePopover?.();
  reopenMenu?.();
}

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
  close.addEventListener("click", cancel); // ✕ = Cancel: back to the menu
  head.append(title, close);
  pop.append(head);
  if (tags.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted tag-pick-empty";
    empty.textContent = "No tags yet — New tag… is in the row menu.";
    pop.append(empty);
  }
  for (const tag of tags) {
    const label = document.createElement("label");
    label.className = "tag-pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    const stored = hasTagEverywhere(state.tagPages, urls, tag.id); // ✓ only when every target carries it
    box.checked = staged.get(tag.id) ?? stored;
    box.addEventListener("change", () => {
      // staged until Apply; a tick back to the stored state is no change at all
      if (box.checked === stored) {
        staged.delete(tag.id);
      } else {
        staged.set(tag.id, box.checked);
      }
      syncApply();
    });
    const dot = document.createElement("span");
    dot.className = "win-dot";
    dot.style.background = tagColorHex(tag.color);
    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = tag.name;
    label.append(box, dot, name);
    pop.append(label);
  }
  // Cancel / Apply: the staged ticks are written only by Apply (New tag… lives in the row menu)
  const actions = document.createElement("div");
  actions.className = "tag-pick-actions";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "tag-pick-cancel";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", cancel);
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "tag-pick-apply";
  apply.textContent = "Apply";
  apply.title = "Enter applies too";
  apply.addEventListener("click", () => applyStaged(ids));
  actions.append(cancelButton, apply);
  pop.append(actions);
  applyButton = apply;
  syncApply();
}

// at: the menu item's click — the picker opens there, kept inside the panel; reopen: the menu
// it came from, for Cancel / ✕
export function openTagAssignPicker(
  at: Pick<MouseEvent, "clientX" | "clientY">,
  ids: number[],
  reopen: (() => void) | null = null,
): void {
  pickerIds = ids;
  reopenMenu = reopen;
  openedAt = at;
  staged.clear(); // every open starts from the stored state
  closingBy = null;
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
