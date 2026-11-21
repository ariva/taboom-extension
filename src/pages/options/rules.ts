// Protected-sites card: the rules as a table in the keep-alive shape — number, On checkbox,
// pattern (click to edit), Expires dropdown, Time left, Remove, draggable onto another row to
// reorder — the Add row, Remove all and Restore last removal (every removal is undoable, newest first).
import { renderRestoreButton } from "./restore-button.ts";
import { makeRule } from "../../app/core.ts";
import { setRuleEnabled, setRuleExpiry, setRulePattern } from "../../app/protection-rules.ts";
import { popRemoval } from "../../app/removal-trash.ts";
import { dropProtectionRules, editProtectionRules, localStore, restoreProtectionRules } from "../../app/storage.ts";
import type { AppState, ProtectionRule, Removal } from "../../app/types.ts";
import { getElementById } from "../../lib/dom.ts";
import { moveItemTo } from "../../lib/list.ts";
import { onBusyClick } from "../../lib/ui/busy-button.ts";
import { inlineEdit } from "../../lib/ui/inline-edit.ts";
import { dragGrip, initRowReorder } from "../../lib/ui/row-reorder.ts";
import { expirySelect, timeLeftCell } from "./expiry-cells.ts";
import { hasRule } from "./model.ts";
import { flashSaved, render, showError } from "./page-state.ts";
import { pluralize } from "../../app/plural.ts";

export async function renderRules(state: AppState): Promise<void> {
  const rows = getElementById("rules");
  if (rows.querySelector(".rename-input")) {
    return; // a pattern edit in progress: the table catches up when it ends (the editor's finish renders)
  }
  rows.textContent = "";
  if (state.protectionRules.length === 0) {
    const cell = document.createElement("td");
    cell.className = "muted";
    cell.colSpan = 6;
    cell.textContent = "No protected sites yet.";
    const empty = document.createElement("tr");
    empty.append(cell);
    rows.append(empty);
  }
  state.protectionRules.forEach((rule, index) => {
    rows.append(ruleRow(rule, index + 1));
  });
  const { protectionTrash = [] } = await localStore.get("protectionTrash");
  renderRestore(protectionTrash);
}

function cell(...children: (Node | string)[]): HTMLTableCellElement {
  const element = document.createElement("td");
  element.append(...children);
  return element;
}

// what the pattern covers, for the cell's tooltip (the cell clips long patterns)
const RULE_KIND: Record<ProtectionRule["type"], string> = {
  host: "Exact host",
  domain: "Domain and its subdomains",
  url: "Exact page",
};

// the pattern is editable in place (click → input, lib/ui/inline-edit): blur / Enter commit
// through makeRule, Escape cancels; the table re-renders either way so an ignored value snaps back
function patternCell(rule: ProtectionRule): HTMLTableCellElement {
  const span = document.createElement("span");
  span.className = "pattern";
  span.textContent = rule.pattern;
  span.title = `${RULE_KIND[rule.type]}: ${rule.pattern}\nClick to edit the pattern`;
  span.addEventListener("click", () => {
    inlineEdit(span, {
      initial: rule.pattern,
      placeholder: "*.example.com",
      commit: async (value) => {
        // applied to the stored list, not the rendered one: a rule added meanwhile must survive
        const after = await editProtectionRules((rules) => setRulePattern(rules, rule.id, value));
        if (after.find((candidate) => candidate.id === rule.id)?.pattern !== rule.pattern) {
          flashSaved();
        }
      },
      finish: render,
    });
  });
  return cell(span);
}

// every row edit goes through the stored-list writer (a rule added meanwhile survives); nothing
// written, nothing flashed when the edit changed nothing
async function save(edit: (rules: ProtectionRule[]) => ProtectionRule[] | undefined): Promise<boolean> {
  let changed = false;
  await editProtectionRules((rules) => {
    const next = edit(rules);
    changed = next !== undefined;
    return next;
  });
  if (changed) {
    flashSaved();
    render();
  }
  return changed;
}

function ruleRow(rule: ProtectionRule, number: number): HTMLTableRowElement {
  // off: the rule stays listed and protects nothing (the panel strikes its badge through)
  const on = document.createElement("input");
  on.type = "checkbox";
  on.checked = !rule.disabled;
  on.title = "Protect the pages this rule covers";
  on.addEventListener("change", () => save((rules) => setRuleEnabled(rules, rule.id, on.checked)));
  // a temporary rule: picked in the row menu or here; the expiry sweep removes it when it ends
  const expires = expirySelect(rule.expiresAt, rule.pattern, (expiresAt) =>
    save((rules) => setRuleExpiry(rules, rule.id, expiresAt)),
  );
  const remove = document.createElement("button");
  remove.textContent = "Remove";
  remove.title = `Remove ${rule.pattern}`;
  remove.addEventListener("click", async () => {
    await dropProtectionRules((rules) => rules.filter((candidate) => candidate.id !== rule.id));
    flashSaved();
    render();
  });
  const row = document.createElement("tr");
  row.draggable = true; // drag onto another row to reorder (initRowReorder); the grip shares the # cell
  row.dataset.key = rule.id;
  row.append(
    cell(dragGrip(), String(number)),
    cell(on),
    patternCell(rule),
    cell(expires),
    timeLeftCell(rule.expiresAt),
    cell(remove),
  );
  return row;
}

// "Restore last removal (N sites)" — only while an action exists; hovering lists what
// comes back, capped so a Remove all of hundreds does not become a screen-high tooltip
function renderRestore(trash: Removal<ProtectionRule>[]): void {
  const newest = popRemoval(trash)?.newest;
  renderRestoreButton(
    getElementById<HTMLButtonElement>("restore-protected"),
    newest ? pluralize(newest.items.length, "site") : null,
    newest?.items.map((rule) => rule.pattern) ?? [],
  );
}

async function addRule(): Promise<void> {
  const input = getElementById("new-rule");
  const rule = makeRule(input.value);
  if (!rule) {
    showError("Type a host (mail.google.com), a domain (*.example.com) or an address (https://…)", "rule-error");
    return; // the text stays to be fixed
  }
  const after = await editProtectionRules((rules) => (hasRule(rules, rule.pattern) ? undefined : [...rules, rule]));
  if (!after.includes(rule)) {
    showError(`${rule.pattern} is already protected`, "rule-error");
    return;
  }
  showError(undefined, "rule-error");
  flashSaved();
  input.value = "";
  render();
}

async function clearAllRules(): Promise<void> {
  const { protectionRules = [] } = await localStore.get("protectionRules");
  if (protectionRules.length === 0 || !confirm("Remove ALL protected sites? You can restore them afterwards.")) {
    return;
  }
  await dropProtectionRules(() => []);
  flashSaved();
  render();
}

async function restoreLastRemoval(): Promise<void> {
  if (await restoreProtectionRules()) {
    flashSaved();
    render();
  }
}

export function initRules(): void {
  // the stored order is the table's order (the # column), nothing else reads it
  initRowReorder(getElementById("rules"), (dragged, target) =>
    save((rules) => moveItemTo(rules, (rule) => rule.id, dragged, target)),
  );
  getElementById("add-rule").addEventListener("click", addRule);
  getElementById("clear-protected").addEventListener("click", clearAllRules);
  onBusyClick(getElementById<HTMLButtonElement>("restore-protected"), restoreLastRemoval);
}
