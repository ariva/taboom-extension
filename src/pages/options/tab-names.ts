// Tab-names card (TAB_NAMES): the rules as a table in the protected-sites shape — number (drag
// the row by its grip onto another to reorder: the first rule covering a page wins), On box,
// pattern and name (click to edit in place), how many open tabs the rule covers, Remove — the Add
// row at the table's foot, Remove all and Restore last removal (every removal is undoable, newest first).
import { applyExperimental, featureEnabled } from "../../app/core.ts";
import { pluralize } from "../../app/plural.ts";
import { popRemoval } from "../../app/removal-trash.ts";
import { dropTabNames, editTabNames, localStore, restoreTabNames } from "../../app/storage.ts";
import { makeTabName, setTabNameEnabled, setTabNameLabel, setTabNamePattern } from "../../app/tab-names.ts";
import { matchesTagPage, tagPagePatternFromInput, tagPagePatternHint } from "../../app/tag-patterns.ts";
import type { AppState, Removal, TabName } from "../../app/types.ts";
import { getElementById } from "../../lib/dom.ts";
import { moveItemTo } from "../../lib/list.ts";
import { onBusyClick } from "../../lib/ui/busy-button.ts";
import { inlineEdit } from "../../lib/ui/inline-edit.ts";
import { dragGrip, initRowReorder } from "../../lib/ui/row-reorder.ts";
import { flashSaved, getFeatures, render, showError } from "./page-state.ts";
import { renderRestoreButton } from "./restore-button.ts";

export async function renderTabNames(state: AppState): Promise<void> {
  const features = applyExperimental(getFeatures(), state.ui.showExperimental ?? false);
  const section = getElementById("tab-names-section");
  section.hidden = !featureEnabled(features, "TAB_NAMES");
  if (section.hidden) {
    return;
  }
  const [{ tabNames = [], tabNamesTrash = [] }, openTabs] = await Promise.all([
    localStore.get(["tabNames", "tabNamesTrash"]),
    chrome.tabs.query({}), // the Tabs column: counted at render time, so it follows every write and a page open
  ]);
  renderRestore(tabNamesTrash);
  const rows = getElementById("tab-name-rows");
  if (rows.querySelector(".rename-input")) {
    return; // an edit in progress: the table catches up when it ends (the editor's finish renders)
  }
  rows.textContent = "";
  if (tabNames.length === 0) {
    const empty = document.createElement("td");
    empty.className = "muted";
    empty.colSpan = 6;
    empty.textContent = "No tab names yet.";
    const row = document.createElement("tr");
    row.append(empty);
    rows.append(row);
  }
  tabNames.forEach((rule, index) => {
    rows.append(ruleRow(rule, index + 1, openTabs));
  });
}

function cell(...children: (Node | string)[]): HTMLTableCellElement {
  const element = document.createElement("td");
  element.append(...children);
  return element;
}

// every row edit goes through the stored-list writer (a rule added meanwhile survives); nothing
// written, nothing flashed when the edit changed nothing
async function save(edit: (list: TabName[]) => TabName[] | undefined): Promise<boolean> {
  const changed = await editTabNames(edit);
  if (changed) {
    flashSaved();
    render();
  }
  return changed;
}

// a text cell editable in place (click → input, lib/ui/inline-edit): blur / Enter commit, Escape
// cancels; the table re-renders either way so an ignored value snaps back
function editableCell(
  className: string,
  text: string,
  title: string,
  placeholder: string,
  edit: (value: string, list: TabName[]) => TabName[] | undefined,
): HTMLTableCellElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  span.title = title;
  span.addEventListener("click", () => {
    inlineEdit(span, {
      initial: text,
      placeholder,
      commit: (value) => save((list) => edit(value, list)),
      finish: render,
    });
  });
  return cell(span);
}

// the Tabs column: how many open tabs the rule covers — whether a pattern is the one meant; the
// tooltip names them
function tabsCell(rule: TabName, openTabs: chrome.tabs.Tab[]): HTMLTableCellElement {
  const covered = openTabs.filter((tab) => matchesTagPage(rule.pattern, tab.url));
  const count = document.createElement("span");
  count.className = "tab-name-tabs";
  count.textContent = String(covered.length);
  const names = covered.map((tab) => tab.title || tab.url || "");
  count.title =
    covered.length === 0
      ? "No open tab is covered by this rule"
      : ["Open tabs covered:", ...names.slice(0, 10), ...(names.length > 10 ? ["…"] : [])].join("\n");
  return cell(count);
}

function ruleRow(rule: TabName, number: number, openTabs: chrome.tabs.Tab[]): HTMLTableRowElement {
  // off: the rule stays listed and names nothing
  const on = document.createElement("input");
  on.type = "checkbox";
  on.checked = !rule.disabled;
  on.title = "Show this name on the tabs the rule covers";
  on.addEventListener("change", () => save((list) => setTabNameEnabled(list, rule.id, on.checked)));
  const remove = document.createElement("button");
  remove.textContent = "Remove";
  remove.title = `Remove the name for ${rule.pattern}`;
  remove.addEventListener("click", async () => {
    await dropTabNames((list) => list.filter((candidate) => candidate.id !== rule.id));
    flashSaved();
    render();
  });
  const row = document.createElement("tr");
  row.draggable = true; // drag onto another row to reorder (initRowReorder); the grip shares the # cell
  row.dataset.key = rule.id;
  row.append(
    cell(dragGrip(), String(number)),
    cell(on),
    editableCell(
      "pattern",
      rule.pattern,
      `${tagPagePatternHint(rule.pattern)}: ${rule.pattern}\nClick to edit the pattern`,
      "https://app.example.com/board, example.com or https://x.com/a/*",
      (value, list) => setTabNamePattern(list, rule.id, value),
    ),
    editableCell("name", rule.name, "Click to edit the name", "Name", (value, list) =>
      setTabNameLabel(list, rule.id, value),
    ),
    tabsCell(rule, openTabs),
    cell(remove),
  );
  return row;
}

function renderRestore(trash: Removal<TabName>[]): void {
  const newest = popRemoval(trash)?.newest;
  renderRestoreButton(
    getElementById<HTMLButtonElement>("restore-tab-names"),
    newest ? pluralize(newest.items.length, "name") : null,
    newest?.items.map((rule) => `${rule.pattern} → ${rule.name}`) ?? [],
  );
}

// the Add row: a pattern (any tagged-page form) and the name; the message line says why a row was refused
async function addTabName(): Promise<void> {
  const patternInput = getElementById<HTMLInputElement>("new-tab-name-pattern");
  const nameInput = getElementById<HTMLInputElement>("new-tab-name");
  const pattern = tagPagePatternFromInput(patternInput.value);
  const name = nameInput.value.trim();
  const { tabNames = [] } = await localStore.get("tabNames");
  if (pattern === "") {
    showError(
      "Type an address, a host or a pattern (https://app.example.com/board, example.com, https://x.com/a/*)",
      "tab-name-error",
    );
    return; // the text stays to be fixed
  }
  if (tabNames.some((rule) => rule.pattern === pattern)) {
    showError(`${pattern} is already listed — edit that row instead`, "tab-name-error");
    return;
  }
  if (name === "") {
    showError("Type the name to show", "tab-name-error");
    return;
  }
  // appended last: the Add row completes the list, a rename from the panel goes first (tab-names.ts)
  await editTabNames((list) =>
    list.some((rule) => rule.pattern === pattern) ? undefined : [...list, makeTabName(pattern, name)],
  );
  showError(undefined, "tab-name-error");
  flashSaved();
  patternInput.value = "";
  nameInput.value = "";
  render();
}

async function clearAll(): Promise<void> {
  const { tabNames = [] } = await localStore.get("tabNames");
  if (tabNames.length === 0 || !confirm("Remove ALL tab names? You can restore them afterwards.")) {
    return;
  }
  await dropTabNames(() => []);
  flashSaved();
  render();
}

async function restoreLastRemoval(): Promise<void> {
  if (await restoreTabNames()) {
    flashSaved();
    render();
  }
}

export function initTabNames(): void {
  // the stored order is the match order: the first rule covering a page names it
  initRowReorder(getElementById("tab-name-rows"), (dragged, target) =>
    save((list) => moveItemTo(list, (rule) => rule.id, dragged, target)),
  );
  getElementById("add-tab-name").addEventListener("click", addTabName);
  getElementById("new-tab-name").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      addTabName();
    }
  });
  getElementById("clear-tab-names").addEventListener("click", clearAll);
  onBusyClick(getElementById<HTMLButtonElement>("restore-tab-names"), restoreLastRemoval);
}
