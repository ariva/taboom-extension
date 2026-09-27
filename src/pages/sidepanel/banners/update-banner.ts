// Update notice: the "update ready" banner with its restart and dismiss buttons.
import { localStore } from "../../../app/storage.ts";
import { getElementById } from "../../../lib/dom.ts";

// ---------- update notice ----------

// reload() applies the deferred update (an open panel blocks auto-install)
const updateBanner = getElementById("update-banner");
const updateRestart = getElementById("update-restart");

async function syncUpdateBanner(): Promise<void> {
  const { updateAvailable, dismissedUpdate, ui } = await localStore.get(["updateAvailable", "dismissedUpdate", "ui"]);
  const show = Boolean(updateAvailable) && updateAvailable !== dismissedUpdate && !(ui?.hideUpdateBanner ?? false);
  if (show) {
    updateRestart.textContent = `Update ${updateAvailable} ready — click to update or restart Taboom`;
    updateRestart.title = "Click to restart Taboom and apply the update";
  }
  updateBanner.hidden = !show;
}

export function initUpdateBanner(): void {
  // reload ONLY from the restart button — a listener on the banner container
  // Deferred out of the click stack: runtime.reload() tears this very document
  // down, and doing that mid-handler is a known crashy path (esp. unpacked).
  updateRestart.addEventListener("click", () => setTimeout(() => chrome.runtime.reload(), 0));

  // dismiss = remember THIS version; the nudge returns only for a newer update
  getElementById("update-dismiss").addEventListener("click", async () => {
    const { updateAvailable } = await localStore.get("updateAvailable");
    await localStore.set({ dismissedUpdate: updateAvailable });
    // the storage echo re-runs syncUpdateBanner in every open panel
  });

  syncUpdateBanner();
  chrome.storage.onChanged.addListener(syncUpdateBanner);
}
