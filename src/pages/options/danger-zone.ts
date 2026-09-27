// Destructive buttons: restore defaults, clear the protected sites, delete everything —
// each behind a confirm().
import { DEFAULTS } from "../../app/core.ts";
import { saveState } from "../../app/storage.ts";
import { getElementById } from "../../lib/dom.ts";
import { flashSaved, render } from "./page-state.ts";
import { applyTheme } from "./ui-prefs.ts";

export function initDangerZone(): void {
  // resets settings + appearance only — protected sites deliberately untouched
  getElementById("restore-defaults").addEventListener("click", async () => {
    if (!confirm("Restore all settings to their defaults? Protected sites are kept.")) {
      return;
    }
    await saveState(structuredClone({ settings: DEFAULTS.settings, ui: DEFAULTS.ui }));
    applyTheme(DEFAULTS.ui.theme);
    flashSaved();
    render();
  });

  getElementById("clear-protected").addEventListener("click", async () => {
    if (!confirm("Remove ALL protected sites? Auto-snooze will apply to them again.")) {
      return;
    }
    await saveState({ protectionRules: [] });
    flashSaved();
    render();
  });

  getElementById("danger").addEventListener("click", async () => {
    if (!confirm("Delete all Taboom settings and protection rules?")) {
      return;
    }
    await chrome.storage.local.clear();
    await saveState(structuredClone(DEFAULTS));
    render();
  });
}
