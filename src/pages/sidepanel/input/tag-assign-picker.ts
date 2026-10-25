// The row menu's Tag URL… / Tag domain… picker (#tag-assign-pop): one checkbox per tag for the clicked
// row (or the selection) — its page entry, or its site entry — ticks staged until Apply; Cancel,
// ✕, Esc and a click outside drop them. Renders refill it while open without losing the staged
// ticks. A new-tag row under the ticks (tick, color swatches, name, Add) writes the tag to the
// list at once and lists it ticked — the tab still waits for Apply.
import { addTag, toggleTagOnPages } from "../../../app/storage.ts";
import { matchesTagPage } from "../../../app/tag-patterns.ts";
import {
  hasTagEverywhere,
  inheritedTagIds,
  orderedTags,
  TAG_NAME_MAX,
  tabsLosingTag,
  type TagOrigin,
  tagColorHex,
  tagNameError,
} from "../../../app/tags.ts";
import { askDialog } from "../../../lib/ui/ask-dialog.ts";
import { refresh } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";
import { ORIGIN_GLYPH } from "../model/rows.ts";
import { rowTagOrigins, TAG_SWATCHES, type TagScope, tagPageUrls } from "../ops/tag-ops.ts";

const pop = document.createElement("div");
pop.id = "tag-assign-pop";
pop.setAttribute("popover", ""); // auto: light dismiss closes it, like the chip's picker
document.body.append(pop);

let pickerIds: number[] | null = null; // the rows the open picker edits; null = closed
let pickerScope: TagScope = "page"; // what those rows stand for: their page entries or their site entries
let reopenMenu: (() => void) | null = null; // Cancel / ✕ bring the row menu back where it was
const staged = new Map<string, boolean>(); // tag id → wanted state, only where it differs from stored
let applyButton: HTMLButtonElement | null = null; // live only while there is something to apply
// the new-tag row's draft: kept across the refills a render causes, reset on every open
let draft = { name: "", color: "blue", tick: true };
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
    const plural = changes.length === 1 ? "" : "s";
    const warning = removalWarning(ids, changes);
    askDialog({
      message: warning === null ? `Apply the tag change${plural}?` : `${warning}\nApply the change${plural}?`,
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
  const urls = tagPageUrls(ids, pickerScope);
  for (const [tagId, on] of changes) {
    await toggleTagOnPages(urls, tagId, on);
  }
  if (changes.length > 0) {
    refresh(true);
  }
}

// an untick that takes a tag off more than one open tab is said before it is written — a domain
// entry or a selection reaches further than the row clicked. null when no untick does
function removalWarning(ids: number[], changes: [string, boolean][]): string | null {
  const urls = tagPageUrls(ids, pickerScope);
  const lines: string[] = [];
  for (const [tagId, on] of changes) {
    if (on) {
      continue;
    }
    const losing = tabsLosingTag(state.tagPages, urls, tagId, state.liveTabs);
    if (losing.length < 2) {
      continue;
    }
    const name = state.tags.find((tag) => tag.id === tagId)?.name ?? "";
    const where = pickerScope === "site" ? ` on ${urls.join(", ")}` : "";
    lines.push(`Unticking "${name}"${where} takes it off ${losing.length} open tabs:`);
    lines.push(...losing.slice(0, 5).map((tab) => `• ${tab.title || tab.url}`));
    if (losing.length > 5) {
      lines.push(`• … and ${losing.length - 5} more`);
    }
  }
  return lines.length === 0 ? null : lines.join("\n");
}

// Apply: one storage write per changed tag, then the refresh redraws badges. A wide removal is
// confirmed first; Cancel brings the picker back with the ticks as they were
async function applyStaged(ids: number[]): Promise<void> {
  const changes = [...staged];
  const warning = removalWarning(ids, changes);
  staged.clear();
  closingBy = "apply";
  pop.hidePopover?.();
  if (warning !== null) {
    const ok = await askDialog({ message: `${warning}\nApply anyway?`, okLabel: "Apply", near: openedAt });
    if (ok !== true) {
      reopenStaged(ids, changes);
      return;
    }
  }
  await writeChanges(ids, changes);
}

function reopenStaged(ids: number[], changes: [string, boolean][]): void {
  pickerIds = ids;
  closingBy = null;
  for (const [tagId, on] of changes) {
    staged.set(tagId, on);
  }
  fill(ids);
  if (!pickerOpen()) {
    pop.showPopover?.();
  }
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

function pickerTitle(ids: number[], urls: string[]): string {
  if (pickerScope === "site") {
    return urls.length === 1 ? `Tags for domain ${urls[0]}` : `Tags for ${urls.length} domains`;
  }
  return ids.length > 1 ? `Tags for ${ids.length} tabs` : "Tags";
}

function fill(ids: number[]): void {
  // a refill mid-typing (a render after Add) must not drop the caret out of the name field
  const typing = pop.querySelector(".tag-new-name") === document.activeElement;
  pop.textContent = "";
  const urls = tagPageUrls(ids, pickerScope);
  const origins = rowTagOrigins(ids); // where each tag the rows carry comes from (the glyph after a name)
  const tags = orderedTags(state.tags, state.tagPages, state.ui); // Settings → Tags order in pickers
  // a tag the page gets from a site or pattern entry stays whatever its own entry says: shown
  // ticked and locked, the entry is edited in Settings → Tagged page rules
  const inherited = pickerScope === "page" ? inheritedTagIds(state.tagPages, urls) : new Set<string>();
  // header like the context menu's: a title and the corner ✕ (closes the picker, the menu stays)
  const head = document.createElement("div");
  head.className = "tag-pick-head";
  const title = document.createElement("span");
  title.className = "tag-pick-title muted";
  title.textContent = pickerTitle(ids, urls);
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
    empty.textContent = "No tags yet — add one below.";
    pop.append(empty);
  }
  for (const tag of tags) {
    const label = document.createElement("label");
    label.className = "tag-pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    const from = origins.get(tag.id) ?? new Set<TagOrigin>();
    const stored = hasTagEverywhere(state.tagPages, urls, tag.id); // ✓ only when every target carries it
    box.checked = staged.get(tag.id) ?? stored;
    if (inherited.has(tag.id)) {
      box.checked = true;
      box.disabled = true;
      label.title = `Comes from a site or pattern entry (${sourcePatterns(urls, tag.id)}) — edit it in Settings → Tagged page rules`;
    }
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
    label.append(box, dot, name, ...originGlyph(from, urls, tag.id));
    pop.append(label);
  }
  pop.append(...newTagRow());
  // Cancel / Apply: the staged ticks are written only by Apply
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
  if (typing) {
    pop.querySelector<HTMLInputElement>(".tag-new-name")?.focus();
  }
}

// the glyph after a name when the tag is not (only) the page's own — ⌂ a domain entry, ✱ a
// pattern — like the row's badge; the hint names the entries
function originGlyph(from: ReadonlySet<TagOrigin>, urls: string[], tagId: string): HTMLElement[] {
  const origin: TagOrigin | undefined = from.has("domain") ? "domain" : from.has("pattern") ? "pattern" : undefined;
  if (!origin) {
    return [];
  }
  const glyph = document.createElement("span");
  glyph.className = "tag-origin muted";
  glyph.textContent = ORIGIN_GLYPH[origin].trim();
  glyph.title =
    origin === "domain"
      ? `On the whole domain (${sourcePatterns(urls, tagId)})`
      : `From a pattern entry (${sourcePatterns(urls, tagId)})`;
  return [glyph];
}

// the new-tag row: [tick] [name] [Add] over the nine swatches, an error line under it. Add writes
// the tag to the list (every page sees it), the tick decides whether it comes staged; Enter in the
// name is Add, not Apply
function newTagRow(): HTMLElement[] {
  const row = document.createElement("div");
  row.className = "tag-pick tag-new";
  const tick = document.createElement("input");
  tick.type = "checkbox";
  tick.className = "tag-new-tick";
  tick.checked = draft.tick;
  tick.title = "Tick the new tag once added";
  tick.addEventListener("change", () => {
    draft.tick = tick.checked;
  });
  const name = document.createElement("input");
  name.type = "text";
  name.className = "tag-new-name";
  name.placeholder = "New tag";
  name.maxLength = TAG_NAME_MAX;
  name.value = draft.name;
  name.addEventListener("input", () => {
    draft.name = name.value;
    showNewTagError(undefined);
  });
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation(); // the picker's own Enter is Apply
      addNewTag();
    }
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "tag-new-add";
  add.textContent = "Add";
  add.addEventListener("click", addNewTag);
  row.append(tick, name, add);
  const swatches = document.createElement("div");
  swatches.className = "tag-new-swatches";
  for (const [colorName, hex] of TAG_SWATCHES) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "tag-new-swatch";
    swatch.dataset.color = colorName;
    swatch.title = colorName[0]?.toUpperCase() + colorName.slice(1);
    swatch.style.background = hex;
    swatch.setAttribute("aria-pressed", String(colorName === draft.color));
    swatch.addEventListener("click", () => {
      draft.color = colorName;
      for (const sibling of swatches.querySelectorAll(".tag-new-swatch")) {
        sibling.setAttribute("aria-pressed", String(sibling === swatch));
      }
    });
    swatches.append(swatch);
  }
  const error = document.createElement("div");
  error.className = "muted tag-new-error";
  error.hidden = true;
  return [row, swatches, error];
}

function showNewTagError(message: string | undefined): void {
  const error = pop.querySelector<HTMLElement>(".tag-new-error");
  if (error) {
    error.hidden = !message;
    error.textContent = message ?? "";
  }
}

async function addNewTag(): Promise<void> {
  // read the field, not the draft: a value set without an input event (tests, autofill) counts too
  draft.name = pop.querySelector<HTMLInputElement>(".tag-new-name")?.value ?? draft.name;
  const error = tagNameError(state.tags, draft.name);
  if (error) {
    showNewTagError(error); // a taken name keeps the row as it is and says so
    return;
  }
  const tag = await addTag(draft.name, draft.color);
  if (!tag) {
    showNewTagError("Could not add the tag"); // the list changed under us (another page added the name)
    return;
  }
  if (draft.tick) {
    staged.set(tag.id, true);
  }
  draft = { ...draft, name: "" };
  await refresh(true); // state.tags carries it
  if (pickerIds) {
    fill(pickerIds); // listed at once, ticked when staged (the render's refill needs :popover-open, absent in happy-dom)
  }
  pop.querySelector<HTMLInputElement>(".tag-new-name")?.focus();
}

// the entries (other than the pages' own) that hand this tag down, for the locked tick's hint
function sourcePatterns(urls: string[], tagId: string): string {
  const own = new Set(urls);
  return state.tagPages
    .filter(
      (page) =>
        !page.disabled && // an off entry hands nothing down (inheritedTagIds skips it too)
        !own.has(page.url) &&
        page.tagIds.includes(tagId) &&
        urls.some((url) => matchesTagPage(page.url, url)),
    )
    .map((page) => page.url)
    .join(", ");
}

// at: the menu item's click — the picker opens there, kept inside the panel; reopen: the menu
// it came from, for Cancel / ✕; scope: the rows' page entries (Tag URL…) or site entries (Tag domain…)
export function openTagAssignPicker(
  at: Pick<MouseEvent, "clientX" | "clientY">,
  ids: number[],
  reopen: (() => void) | null = null,
  scope: TagScope = "page",
): void {
  pickerIds = ids;
  pickerScope = scope;
  draft = { name: "", color: "blue", tick: true };
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
