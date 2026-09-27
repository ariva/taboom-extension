// Protected-sites list: renders the rules with their remove buttons and adds new ones.
import { makeRule } from "../../app/core.ts";
import { loadState, saveState } from "../../app/storage.ts";
import type { AppState } from "../../app/types.ts";
import { getElementById } from "../../lib/dom.ts";
import { hasRule } from "./model.ts";
import { flashSaved, render } from "./page-state.ts";

export function renderRules(state: AppState): void {
  const list = getElementById("rules");
  list.textContent = "";
  if (state.protectionRules.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No protected sites yet.";
    list.append(li);
  }
  for (const rule of state.protectionRules) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = rule.pattern;
    const remove = document.createElement("button");
    remove.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    remove.title = remove.ariaLabel = `Remove ${rule.pattern}`;
    remove.addEventListener("click", async () => {
      await saveState({
        protectionRules: state.protectionRules.filter((r) => r.id !== rule.id),
      });
      flashSaved();
      render();
    });
    li.append(span, remove);
    list.append(li);
  }
}

export function initRules(): void {
  getElementById("add-rule").addEventListener("click", async () => {
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
  });
}
