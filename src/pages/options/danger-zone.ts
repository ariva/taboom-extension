// Destructive buttons: restore defaults, delete everything (each behind a confirm()) and
// forgetting the undo history (no confirm).
// (Clear protected sites / keep-alive marks live in their own cards, with Restore.)
import { DEFAULTS } from "../../app/core.ts";
import { localStore, saveState } from "../../app/storage.ts";
import { getElementById } from "../../lib/dom.ts";
import { flashSaved, render } from "./page-state.ts";
import { applyTheme } from "./ui-prefs.ts";

// "Delete restore data" only makes sense while an undo stack has something in it
export async function renderDangerZone(): Promise<void> {
  const { keepAliveTrash = [], protectionTrash = [] } = await localStore.get(["keepAliveTrash", "protectionTrash"]);
  getElementById<HTMLButtonElement>("delete-restore-data").disabled =
    keepAliveTrash.length === 0 && protectionTrash.length === 0;
}

export function initDangerZone(): void {
  // no confirm: the data is only undo history, and the button is dead while there is none
  getElementById("delete-restore-data").addEventListener("click", async () => {
    await localStore.set({ keepAliveTrash: [], protectionTrash: [] });
    flashSaved();
    render(); // only trash keys changed — the storage listener does not re-render for those
  });

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

  getElementById("danger").addEventListener("click", async () => {
    if (!confirm("Delete all Taboom settings and protection rules?")) {
      return;
    }
    await chrome.storage.local.clear();
    await saveState(structuredClone(DEFAULTS));
    render();
  });
}
