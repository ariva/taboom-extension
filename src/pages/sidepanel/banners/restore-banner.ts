// Panel-open tracking (the port the service worker watches) and the restore banner.
import { send } from "../../../app/messages.ts";
import { localStore } from "../../../app/storage.ts";
import { getElementById } from "../../../lib/dom.ts";
import { openPanel } from "../../../lib/platform/panel.ts";

// ---------- panel-open tracking + restore banner ----------
// The held port tells the service worker THIS window has a panel; the SW
// persists that on the window's logical profile. On load we ask which OTHER
// windows had a panel before the update/restart and offer to reopen them —
// the banner click supplies the user gesture sidePanel.open() requires.

async function trackPanelOpen(): Promise<number> {
  const win = await chrome.windows.getCurrent();
  const connect = () => {
    const port = chrome.runtime.connect({ name: `sidepanel:${win.id}` });
    // the worker gets idle-killed routinely — reconnect so the flag stays live
    port.onDisconnect.addListener(() => setTimeout(connect, 1000));
  };
  connect();
  return win.id!; // live windows always have an id (only sessions-API windows lack one)
}

export function initRestoreBanner(): void {
  trackPanelOpen().then(async (windowId) => {
    // an error answer (or none at all) has no windows
    const response = await send({ type: "panels-to-restore", excludeWindowId: windowId }).catch(() => null);
    const windows = response && "windows" in response ? response.windows : [];
    if (windows.length === 0) {
      return;
    }
    const { ui } = await localStore.get("ui");
    const mode = ui?.onExtensionUpdate ?? "banner";
    const forget = () => send({ type: "panels-restore-dismiss", windowIds: windows }).catch(() => {});
    if (mode === "none") {
      forget(); // same as dismissing the banner — those windows aren't offered again
      return;
    }
    // forget FIRST: each reopened panel asks panels-to-restore as it loads, and
    // a sibling whose port hasn't connected yet would still be offered to it —
    // onConnect flips the flag back to true for every panel that does open
    const reopenAll = async () => {
      await forget();
      let allOpened = true;
      for (const id of windows) {
        await openPanel(id).catch(() => {
          allOpened = false;
        });
      }
      return allOpened;
    };
    // sidePanel.open() wants a user gesture; a fresh page has none, so "auto"
    // is best-effort — when Chrome refuses, fall through to the banner
    if (mode === "auto" && (await reopenAll())) {
      return;
    }
    const banner = getElementById("restore-banner");
    getElementById("restore-open").textContent =
      `Side panel was open in ${windows.length} other window${windows.length > 1 ? "s" : ""} — restore?`;
    getElementById("restore-open").addEventListener("click", async () => {
      await reopenAll();
      banner.hidden = true;
    });
    getElementById("restore-dismiss").addEventListener("click", () => {
      banner.hidden = true;
      forget();
    });
    banner.hidden = false;
  });
}
