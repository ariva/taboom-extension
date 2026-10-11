// Protected-sites card: the rule chips with their remove buttons, the Add row,
// Remove all and Restore last removal (every removal is undoable, newest first).
import { makeRule } from "../../app/core.ts";
import { setRulePattern } from "../../app/protection-rules.ts";
import { popRemoval } from "../../app/removal-trash.ts";
import { dropProtectionRules, loadState, localStore, restoreProtectionRules, saveState } from "../../app/storage.ts";
import type { AppState, ProtectionRule, Removal } from "../../app/types.ts";
import { getElementById } from "../../lib/dom.ts";
import { inlineEdit } from "../../lib/ui/inline-edit.ts";
import { hasRule } from "./model.ts";
import { flashSaved, render } from "./page-state.ts";

const TOOLTIP_PATTERNS = 10;

export async function renderRules(state: AppState): Promise<void> {
  const list = getElementById("rules");
  list.textContent = "";
  if (state.protectionRules.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No protected sites yet.";
    list.append(li);
  }
  for (const rule of state.protectionRules) {
    list.append(ruleChip(state.protectionRules, rule));
  }
  const { protectionTrash = [] } = await localStore.get("protectionTrash");
  renderRestore(protectionTrash);
}

// the pattern is editable in place (click → input, lib/ui/inline-edit): blur / Enter
// commit through makeRule, Escape cancels; the list re-renders either way so an
// ignored value snaps back
// what the pattern covers, for the chip's tooltip (the chip itself clips long patterns)
const RULE_KIND: Record<ProtectionRule["type"], string> = {
  host: "Exact host",
  domain: "Domain and its subdomains",
  url: "Exact page",
};

function ruleChip(rules: ProtectionRule[], rule: ProtectionRule): HTMLLIElement {
  const li = document.createElement("li");
  const span = document.createElement("span");
  span.textContent = rule.pattern;
  span.title = `${RULE_KIND[rule.type]}: ${rule.pattern}\nClick to edit the pattern`;
  span.addEventListener("click", () => {
    // freeze the chip at its current width (0 in the DOM-less tests: skip) so the editor
    // fills the text's slot instead of resizing the chip; the re-render on finish drops it
    if (li.offsetWidth > 0) {
      li.style.width = `${li.offsetWidth}px`;
    }
    inlineEdit(span, {
      initial: rule.pattern,
      placeholder: "*.example.com",
      commit: async (value) => {
        const next = setRulePattern(rules, rule.id, value);
        if (next) {
          await saveState({ protectionRules: next });
          flashSaved();
        }
      },
      finish: render,
    });
  });
  const remove = document.createElement("button");
  remove.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  remove.title = remove.ariaLabel = `Remove ${rule.pattern}`;
  remove.addEventListener("click", async () => {
    await dropProtectionRules((rules) => rules.filter((r) => r.id !== rule.id));
    flashSaved();
    render();
  });
  li.append(span, remove);
  return li;
}

// "Restore last removal (N sites)" — only while an action exists; hovering lists what
// comes back, capped so a Remove all of hundreds does not become a screen-high tooltip
function renderRestore(trash: Removal<ProtectionRule>[]): void {
  const button = getElementById<HTMLButtonElement>("restore-protected");
  const newest = popRemoval(trash)?.newest;
  button.hidden = !newest;
  if (newest) {
    const count = newest.items.length;
    button.textContent = `Restore last removal (${count} site${count === 1 ? "" : "s"})`;
    const patterns = newest.items.slice(0, TOOLTIP_PATTERNS).map((rule) => rule.pattern);
    button.title = ["Restore:", ...patterns, ...(count > TOOLTIP_PATTERNS ? ["…"] : [])].join("\n");
  }
}

async function addRule(): Promise<void> {
  const input = getElementById("new-rule");
  const rule = makeRule(input.value);
  if (!rule) {
    return;
  }
  const state = await loadState();
  if (!hasRule(state.protectionRules, rule.pattern)) {
    await saveState({ protectionRules: [...state.protectionRules, rule] });
    flashSaved();
  }
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
  getElementById("add-rule").addEventListener("click", addRule);
  getElementById("clear-protected").addEventListener("click", clearAllRules);
  getElementById("restore-protected").addEventListener("click", restoreLastRemoval);
}
