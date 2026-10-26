// Tags card: the tag table (color select, click-to-edit name, pages count, Remove), an Add
// row (name + color), the tagged-pages table (click-to-edit address or pattern, one toggle
// chip per tag, Remove), an Add row (address / pattern + tag), Remove all and Restore last removal.
import { applyExperimental, featureEnabled } from "../../app/core.ts";
import { popRemoval } from "../../app/removal-trash.ts";
import {
  addTag,
  clearTags,
  editTag,
  editTagPage,
  loadState,
  localStore,
  removeTagPagesToTrash,
  removeTagsToTrash,
  renameStoredTagPage,
  reorderTags,
  restoreTags,
  saveState,
  setPageTagIds,
} from "../../app/storage.ts";
import {
  nextTagSort,
  orderedTags,
  pageCountByTag,
  sortedTagPages,
  sortedTags,
  tabsLosingTag,
  TAG_COLORS,
  tagColorHex,
  tagNameError,
  tagPageError,
  usesDarkText,
} from "../../app/tags.ts";
import { matchesTagPage, tagPagePatternFromInput, tagPagePatternHint } from "../../app/tag-patterns.ts";
import type {
  AppState,
  Removal,
  Tag,
  TagPage,
  TagPageSort,
  TagPageSortKey,
  TagRemoval,
  TagSort,
  TagSortKey,
  UiPrefs,
} from "../../app/types.ts";
import { closest, getElementById } from "../../lib/dom.ts";
import { inlineEdit } from "../../lib/ui/inline-edit.ts";
import { flashSaved, getFeatures, render } from "./page-state.ts";

// header sort of the tag table (ui.tagSort, saved on every click); the stored order (drag) stays.
// Mirrored here from the last render, with the picker-order prefs the page's own pickers read
let tagSort: TagSort | null = null;
let tagPageSort: TagPageSort | null = null; // the tagged-pages table's own sort (ui.tagPageSort)
let pickerUi: Pick<UiPrefs, "tagSort" | "tagPickOrder"> = { tagPickOrder: "stored" };

function cell(...children: (Node | string)[]): HTMLTableCellElement {
  const element = document.createElement("td");
  element.append(...children);
  return element;
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option"); // not `new Option()`: happy-dom lacks the constructor
  element.value = value;
  element.textContent = label;
  return element;
}

// the nine color names; the left border is the swatch (no second element to lay out)
function fillColorOptions(select: HTMLSelectElement, current: string): HTMLSelectElement {
  select.textContent = "";
  for (const name of Object.keys(TAG_COLORS)) {
    select.append(option(name, name[0]?.toUpperCase() + name.slice(1)));
  }
  select.value = current;
  select.style.borderLeft = `0.5rem solid ${tagColorHex(current)}`;
  select.addEventListener("change", () => {
    select.style.borderLeft = `0.5rem solid ${tagColorHex(select.value)}`;
  });
  return select;
}

function colorSelect(current: string): HTMLSelectElement {
  return fillColorOptions(document.createElement("select"), current);
}

// the tag table's message (#tag-error) or the tagged pages' (#tag-page-error, under its Add row)
function showError(message: string | undefined, id = "tag-error"): void {
  const error = getElementById(id);
  error.hidden = !message;
  error.textContent = message ?? "";
}

export async function renderTags(state: AppState): Promise<void> {
  const features = applyExperimental(getFeatures(), state.ui.showExperimental ?? false);
  const section = getElementById("tags-section");
  section.hidden = !featureEnabled(features, "TAGS");
  if (section.hidden) {
    return;
  }
  const [{ tags = [], tagPages = [], tagTrash = [] }, openTabs] = await Promise.all([
    localStore.get(["tags", "tagPages", "tagTrash"]),
    chrome.tabs.query({}), // the Open column: counted at render time, so it follows every write and a page open
  ]);
  tagSort = state.ui.tagSort ?? null;
  tagPageSort = state.ui.tagPageSort ?? null;
  pickerUi = state.ui;
  renderRestore(tagTrash);
  renderTagRows(tags, tagPages);
  renderPageRows(tags, tagPages, openTabs);
  fillPagePicker(tags, tagPages); // an open picker follows every write
  // the Add-page tag dropdown lists the current tags
  const pick = getElementById<HTMLSelectElement>("new-tag-page-tag");
  const previous = pick.value;
  pick.textContent = "";
  for (const tag of orderedTags(tags, tagPages, pickerUi)) {
    pick.append(option(tag.id, tag.name));
  }
  pick.disabled = tags.length === 0;
  if (tags.some((tag) => tag.id === previous)) {
    pick.value = previous;
  }
}

function emptyRow(text: string, span: number): HTMLTableRowElement {
  const empty = document.createElement("td");
  empty.className = "muted";
  empty.colSpan = span;
  empty.textContent = text;
  const row = document.createElement("tr");
  row.append(empty);
  return row;
}

// six dots: the row is a drag handle
function dragGrip(): HTMLSpanElement {
  const grip = document.createElement("span");
  grip.className = "drag-grip";
  grip.title = "Drag to reorder";
  grip.innerHTML =
    '<svg viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="2.5" r="1.3"/><circle cx="7" cy="2.5" r="1.3"/><circle cx="3" cy="7" r="1.3"/><circle cx="7" cy="7" r="1.3"/><circle cx="3" cy="11.5" r="1.3"/><circle cx="7" cy="11.5" r="1.3"/></svg>'; // constant markup
  return grip;
}

function renderTagRows(tags: Tag[], pages: TagPage[]): void {
  const rows = getElementById("tag-rows");
  rows.textContent = "";
  if (tags.length === 0) {
    rows.append(emptyRow("No tags yet.", 7));
  }
  const counts = pageCountByTag(pages);
  renderSortHeaders("tag-table", tagSort);
  // the # column keeps the stored position, so a sorted view still tells where a row lives
  const stored = new Map(tags.map((tag, index) => [tag.id, index + 1]));
  for (const tag of sortedTags(tags, counts, tagSort)) {
    const index = (stored.get(tag.id) ?? 1) - 1;
    const color = colorSelect(tag.color);
    color.addEventListener("change", async () => {
      if (await editTag(tag.id, { color: color.value })) {
        flashSaved();
      }
      render();
    });
    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = tag.name;
    const nameCell = cell(name);
    nameCell.title = "Click to rename";
    nameCell.addEventListener("click", () => {
      if (nameCell.querySelector(".rename-input")) {
        return; // a click inside the open editor
      }
      inlineEdit(name, {
        initial: tag.name,
        placeholder: "Tag name",
        commit: async (value) => {
          const error = value.trim() === tag.name ? undefined : tagNameError(tags, value, tag.id);
          showError(error);
          if (!error && (await editTag(tag.id, { name: value }))) {
            flashSaved();
          }
        },
        finish: render,
      });
    });
    // on / off: off keeps the tag and its pages here, and hides it everywhere else
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.className = "tag-enabled";
    enabled.checked = !tag.disabled;
    enabled.title = tag.disabled
      ? "Off: hidden in the side panel and menus — switch on to show it"
      : "On — switch off to hide this tag everywhere but here";
    enabled.addEventListener("change", async () => {
      if (await editTag(tag.id, { enabled: enabled.checked })) {
        flashSaved();
      }
      render();
    });
    const remove = document.createElement("button");
    remove.className = "remove-tag";
    remove.textContent = "Remove";
    remove.title = `Remove the tag "${tag.name}" from every page`;
    remove.addEventListener("click", async () => {
      if (await removeTagsToTrash([tag.id])) {
        flashSaved();
        render();
      }
    });
    const row = document.createElement("tr");
    // drag onto another row to reorder: the order drives badges, menus, Group by tag — only in the
    // stored order (a drop in a sorted view would land somewhere else than it looks)
    row.draggable = tagSort === null;
    row.dataset.tagId = tag.id;
    if (tag.disabled) {
      row.classList.add("off");
    }
    row.append(
      cell(dragGrip()),
      cell(String(index + 1)),
      cell(enabled),
      cell(color),
      nameCell,
      cell(String(counts.get(tag.id) ?? 0)),
      cell(remove),
    );
    rows.append(row);
  }
}

// the sortable headers of a table carry the arrow of the active sort (data-dir) and a hint
function renderSortHeaders(tableId: string, sort: { key: string; dir: "asc" | "desc" } | null): void {
  for (const header of document.querySelectorAll<HTMLElement>(`#${tableId} th[data-sort]`)) {
    // the # header stands for the stored order: active while no column sort is on
    const stored = header.dataset.sort === "stored";
    const active = stored ? sort === null : sort !== null && sort.key === header.dataset.sort;
    const dir = stored ? "asc" : sort?.dir;
    if (active && dir) {
      header.dataset.dir = dir;
    } else {
      delete header.dataset.dir;
    }
    const arrow = header.querySelector(".sort-arrow");
    if (arrow) {
      arrow.textContent = active ? (dir === "asc" ? "▲" : "▼") : "⇅";
    }
    if (stored) {
      const drag = tableId === "tag-table" ? " (drag rows to change it)" : "";
      header.title = active ? `The stored order${drag}` : "Click for the stored order";
    } else {
      header.title = active
        ? dir === "asc"
          ? "Sorted ascending — click for descending"
          : "Sorted descending — click for the stored order"
        : "Click to sort by this column";
    }
  }
}

// drag & drop reorder of the tag rows — the dragged row lands at the target's index
let draggedTagId: string | null = null; // dataTransfer is unreadable during dragover — track here
let dropRow: HTMLElement | null = null;

function clearDropRow(): void {
  dropRow?.classList.remove("drop-target");
  dropRow = null;
}

function tagRowUnder(event: Event): HTMLElement | null {
  const row = closest(event.target, "#tag-rows tr[data-tag-id]");
  return row && draggedTagId !== null && row.dataset.tagId !== draggedTagId ? row : null;
}

function initTagReorder(): void {
  const rows = getElementById("tag-rows");
  rows.addEventListener("dragstart", (event) => {
    const row = closest(event.target, "tr[data-tag-id]");
    draggedTagId = row?.dataset.tagId ?? null;
    row?.classList.add("dragging"); // dimmed while it travels; a re-render or dragend clears it
  });
  rows.addEventListener("dragover", (event) => {
    const row = tagRowUnder(event);
    if (!row) {
      clearDropRow();
      return; // not a target — the browser shows the no-drop cursor
    }
    event.preventDefault();
    if (row !== dropRow) {
      clearDropRow();
      dropRow = row;
      row.classList.add("drop-target");
    }
  });
  rows.addEventListener("drop", async (event) => {
    const row = tagRowUnder(event);
    const dragged = draggedTagId;
    draggedTagId = null;
    clearDropRow();
    if (row && dragged !== null && row.dataset.tagId && (await reorderTags(dragged, row.dataset.tagId))) {
      event.preventDefault();
      flashSaved();
      render();
    }
  });
  rows.addEventListener("dragend", (event) => {
    draggedTagId = null;
    clearDropRow();
    closest(event.target, "tr[data-tag-id]")?.classList.remove("dragging");
  });
}

// taking a tag off an entry that covers more than one open tab is confirmed first, naming them
async function confirmedUntick(url: string, tag: Tag): Promise<boolean> {
  const [{ tagPages = [] }, tabs] = await Promise.all([localStore.get("tagPages"), chrome.tabs.query({})]);
  const losing = tabsLosingTag(tagPages, [url], tag.id, tabs);
  if (losing.length < 2) {
    return true;
  }
  const names = losing.slice(0, 5).map((tab) => `• ${tab.title || tab.url}`);
  const more = losing.length > 5 ? [`• … and ${losing.length - 5} more`] : [];
  return confirm(
    [
      `Taking "${tag.name}" off ${url} removes it from ${losing.length} open tabs:`,
      ...names,
      ...more,
      "Continue?",
    ].join("\n"),
  );
}

// a page's tag as a solid chip with a ✕ (the last one off leaves the rule without chips — Remove drops it)
function pageChip(tag: Tag, page: TagPage): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = usesDarkText(tag.color) ? "tag-chip dark" : "tag-chip";
  if (tag.disabled) {
    chip.className = "tag-chip off"; // switched off: grey, struck through, still removable
    chip.title = `"${tag.name}" is switched off (the Tags table) — shown nowhere until switched on`;
  }
  chip.style.background = tag.disabled ? "" : tagColorHex(tag.color); // the off chip takes the CSS grey
  const name = document.createElement("span");
  name.className = "tag-chip-name";
  name.textContent = tag.name;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "tag-chip-remove";
  remove.textContent = "✕";
  remove.title = remove.ariaLabel = `Remove "${tag.name}" from this page`;
  remove.addEventListener("click", async () => {
    if (
      (await confirmedUntick(page.url, tag)) &&
      (await setPageTagIds(
        page.url,
        page.tagIds.filter((id) => id !== tag.id),
      ))
    ) {
      flashSaved();
      render();
    }
  });
  chip.append(name, remove);
  return chip;
}

// up to this many chips on a row; the rest is a "+N" and the picker lists them all
const CHIPS_SHOWN = 3;

// the Tags cell: chips for the first tags (tag-list order), "+N", the Tags ▾ picker button
function pageTagsCell(tags: Tag[], page: TagPage): HTMLTableCellElement {
  const carried = tags.filter((tag) => page.tagIds.includes(tag.id));
  const shown = carried.slice(0, CHIPS_SHOWN).map((tag) => pageChip(tag, page));
  const more = document.createElement("span");
  more.className = "tag-more";
  more.textContent = `+${carried.length - CHIPS_SHOWN}`;
  more.title = carried
    .slice(CHIPS_SHOWN)
    .map((tag) => tag.name)
    .join(", ");
  const pickButton = document.createElement("button");
  pickButton.type = "button";
  pickButton.className = "tag-pick-btn";
  pickButton.textContent = "Tags ▾";
  pickButton.title = "Add or remove this page's tags";
  pickButton.addEventListener("click", () => openPagePicker(pickButton, page.url));
  // one flex line: chips shrink and ellipsize before anything wraps; the count and the button never shrink
  const line = document.createElement("div");
  line.className = "tag-chips";
  line.append(...shown, ...(carried.length > CHIPS_SHOWN ? [more] : []), pickButton);
  return cell(line);
}

// ---------- the shared page picker (#tag-page-pick): one tick per tag for one page ----------

let pickerUrl: string | null = null; // the page the open picker edits; null = closed

function fillPagePicker(tags: Tag[], pages: TagPage[]): void {
  const pick = getElementById("tag-page-pick");
  pick.textContent = "";
  const url = pickerUrl;
  if (url === null) {
    return;
  }
  // header like the side panel's picker: a title and the corner ✕
  const head = document.createElement("div");
  head.className = "tag-pick-head";
  const title = document.createElement("span");
  title.className = "tag-pick-title muted";
  title.textContent = "Tags";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "tag-pick-close";
  close.title = close.ariaLabel = "Close";
  close.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>'; // constant markup
  close.addEventListener("click", () => {
    pickerUrl = null;
    pick.hidePopover?.();
  });
  head.append(title, close);
  pick.append(head);
  // a rule whose last tag was unticked stays listed: the picker then offers every tag unticked
  const current = pages.find((page) => page.url === url)?.tagIds ?? [];
  if (orderedTags(tags, pages, pickerUi).length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = tags.length === 0 ? "No tags yet." : "Every tag is switched off.";
    pick.append(empty);
    return;
  }
  for (const tag of orderedTags(tags, pages, pickerUi)) {
    // a switched-off tag is not offered; a page that carries it keeps it (struck-through chip)
    const label = document.createElement("label");
    label.className = "tag-pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = current.includes(tag.id);
    box.addEventListener("change", async () => {
      if (!box.checked && !(await confirmedUntick(url, tag))) {
        box.checked = true; // declined: the tick stays
        return;
      }
      const next = box.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id);
      if (await setPageTagIds(url, next)) {
        flashSaved();
        render(); // renderTags refills the open picker
      }
    });
    const dot = document.createElement("span");
    dot.className = "tag-dot";
    dot.style.background = tagColorHex(tag.color);
    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = tag.name;
    label.append(box, dot, name);
    pick.append(label);
  }
}

async function openPagePicker(anchor: HTMLElement, url: string): Promise<void> {
  const pick = getElementById("tag-page-pick");
  pickerUrl = url;
  const { tags = [], tagPages = [] } = await localStore.get(["tags", "tagPages"]);
  fillPagePicker(tags, tagPages);
  try {
    pick.showPopover();
  } catch {
    // already open (another row's button) or no popover API (tests) — the content is refilled either way
  }
  // under the button, kept inside the window (measured after the show: a hidden popover has no size)
  const rect = anchor.getBoundingClientRect();
  pick.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - pick.offsetHeight - 8)}px`;
  pick.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pick.offsetWidth - 8))}px`;
}

// the Tabs column: how many open tabs the entry covers — the number tells whether a domain or
// pattern is the one meant; the tooltip names them
function openTabsCell(page: TagPage, openTabs: chrome.tabs.Tab[]): HTMLTableCellElement {
  const covered = openTabs.filter((tab) => matchesTagPage(page.url, tab.url));
  const count = document.createElement("span");
  count.className = "tag-page-tabs";
  count.textContent = String(covered.length);
  const names = covered.map((tab) => tab.title || tab.url || "");
  count.title =
    covered.length === 0
      ? "No open tab is covered by this entry"
      : ["Open tabs covered:", ...names.slice(0, 10), ...(names.length > 10 ? ["…"] : [])].join("\n");
  return cell(count);
}

function renderPageRows(tags: Tag[], pages: TagPage[], openTabs: chrome.tabs.Tab[]): void {
  const rows = getElementById("tag-page-rows");
  rows.textContent = "";
  if (pages.length === 0) {
    rows.append(emptyRow("No tagged page rules yet.", 6));
  }
  renderSortHeaders("tag-page-table", tagPageSort);
  // the # column keeps the stored position, like the tag table
  const stored = new Map(pages.map((page, index) => [page.url, index]));
  const tabCounts = new Map(
    pages.map((page) => [page.url, openTabs.filter((tab) => matchesTagPage(page.url, tab.url)).length]),
  );
  for (const page of sortedTagPages(pages, tabCounts, tagPageSort, tags)) {
    const index = stored.get(page.url) ?? 0;
    const url = document.createElement("span");
    url.className = "url";
    url.textContent = page.url;
    const pageCell = cell(url);
    pageCell.title = `${tagPagePatternHint(page.url)}: ${page.url}\nClick to edit — an address, a host (subdomains included), a word any host contains, or a pattern with *`;
    pageCell.addEventListener("click", () => {
      if (pageCell.querySelector(".rename-input")) {
        return;
      }
      inlineEdit(url, {
        initial: page.url,
        placeholder: "https://app.example.com/board or example.com or https://x.com/a/*",
        // re-keyed in one write (tags and switch travel with the entry); the same pattern changes
        // nothing; junk or another row's key is refused with a message
        commit: async (value) => {
          const error = tagPageError(pages, value, page.url);
          showError(error, "tag-page-error");
          if (error) {
            return;
          }
          if (await renameStoredTagPage(page.url, value)) {
            flashSaved();
          }
        },
        finish: render,
      });
    });
    const chips = pageTagsCell(tags, page);
    // on / off: off keeps the entry here and makes it cover no tab until switched on
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.className = "tag-page-enabled";
    enabled.checked = !page.disabled;
    enabled.title = page.disabled
      ? "Off: covers no tab — switch on to tag its pages again"
      : "On — switch off to keep the entry without tagging its pages";
    enabled.addEventListener("change", async () => {
      if (await editTagPage(page.url, { enabled: enabled.checked })) {
        flashSaved();
      }
      render();
    });
    const remove = document.createElement("button");
    remove.className = "remove-page";
    remove.textContent = "Remove";
    remove.title = "Remove this rule from the tagged page rules";
    remove.addEventListener("click", async () => {
      if (await removeTagPagesToTrash([page.url])) {
        flashSaved();
        render();
      }
    });
    const row = document.createElement("tr");
    if (page.disabled) {
      row.classList.add("off");
    }
    row.append(cell(String(index + 1)), cell(enabled), pageCell, chips, openTabsCell(page, openTabs), cell(remove));
    rows.append(row);
  }
}

// "Restore last removal (N tags)" / "(N rules)" — only while an action exists
function renderRestore(trash: Removal<TagRemoval>[]): void {
  const button = getElementById<HTMLButtonElement>("restore-tags");
  const newest = popRemoval(trash)?.newest;
  button.hidden = !newest;
  if (!newest) {
    return;
  }
  const tagCount = newest.items.reduce((sum, removal) => sum + removal.tags.length, 0);
  const pageCount = newest.items.reduce((sum, removal) => sum + removal.pages.length, 0);
  const what =
    tagCount > 0 ? `${tagCount} tag${tagCount === 1 ? "" : "s"}` : `${pageCount} rule${pageCount === 1 ? "" : "s"}`;
  button.textContent = `Restore last removal (${what})`;
  const names = newest.items.flatMap((removal) => [
    ...removal.tags.map((tag) => tag.name),
    ...removal.pages.map((page) => page.url),
  ]);
  button.title = ["Restore:", ...names.slice(0, 10), ...(names.length > 10 ? ["…"] : [])].join("\n");
}

async function addTypedTag(): Promise<void> {
  const input = getElementById<HTMLInputElement>("new-tag-name");
  const { tags = [] } = await localStore.get("tags");
  const error = tagNameError(tags, input.value);
  showError(error);
  if (error) {
    return;
  }
  if (await addTag(input.value, getElementById<HTMLSelectElement>("new-tag-color").value)) {
    input.value = "";
    flashSaved();
    render();
  }
}

// a page tagged by its address — or a site / pattern — without opening it (like the keep-alive
// Add row). Junk or an address already listed is refused with a message and stays in the input.
async function addTypedPage(): Promise<void> {
  const input = getElementById<HTMLInputElement>("new-tag-page");
  const tagId = getElementById<HTMLSelectElement>("new-tag-page-tag").value;
  const { tagPages = [] } = await localStore.get("tagPages");
  const error = tagPageError(tagPages, input.value);
  showError(error, "tag-page-error");
  if (error || tagId === "") {
    return;
  }
  if (await setPageTagIds(tagPagePatternFromInput(input.value), [tagId])) {
    input.value = "";
    flashSaved();
    render();
  }
}

async function clearAllTags(): Promise<void> {
  const { tags = [], tagPages = [] } = await localStore.get(["tags", "tagPages"]);
  if (
    (tags.length === 0 && tagPages.length === 0) ||
    !confirm("Remove ALL tags and tagged page rules? You can restore them afterwards.")
  ) {
    return;
  }
  if (await clearTags()) {
    flashSaved();
    render();
  }
}

export function initTags(): void {
  fillColorOptions(getElementById<HTMLSelectElement>("new-tag-color"), "blue");
  initTagReorder();
  getElementById("tag-table").addEventListener("click", async (event) => {
    const header = closest(event.target, "th[data-sort]");
    if (!header) {
      return;
    }
    // "stored" = the # header: back to the stored order; the markup carries the three column keys
    const next = header.dataset.sort === "stored" ? null : nextTagSort(tagSort, header.dataset.sort as TagSortKey);
    const { ui } = await loadState();
    const { tagSort: _previous, ...rest } = ui;
    await saveState({ ui: next ? { ...rest, tagSort: next } : rest }); // saved at once; absent = stored order
    flashSaved();
    render(); // the storage listener re-renders too; this one is for the page that wrote
  });
  getElementById("tag-page-table").addEventListener("click", async (event) => {
    const header = closest(event.target, "th[data-sort]");
    if (!header) {
      return;
    }
    const next =
      header.dataset.sort === "stored" ? null : nextTagSort(tagPageSort, header.dataset.sort as TagPageSortKey);
    const { ui } = await loadState();
    const { tagPageSort: _previous, ...rest } = ui;
    await saveState({ ui: next ? { ...rest, tagPageSort: next } : rest });
    flashSaved();
    render();
  });
  // light dismiss closed the picker: forget its page so a re-render does not refill a closed box
  getElementById("tag-page-pick").addEventListener("toggle", (event) => {
    if ((event as ToggleEvent).newState === "closed") {
      pickerUrl = null;
    }
  });
  getElementById("add-tag").addEventListener("click", addTypedTag);
  getElementById("add-tag-page").addEventListener("click", addTypedPage);
  getElementById("clear-tags").addEventListener("click", clearAllTags);
  getElementById("restore-tags").addEventListener("click", async () => {
    if (await restoreTags()) {
      flashSaved();
      render();
    }
  });
}
