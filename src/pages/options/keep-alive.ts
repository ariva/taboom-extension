// Keep-tabs-alive card: the default-interval dropdown, the table of marks —
// numbered, each with its pause checkbox, own interval, a live countdown to the
// next reload and Remove — an Add row for a page that is not open, Remove all and Restore last removal. The enable checkbox and default interval are
// settings — settings-form.ts persists them; this module only shows / hides.
import { applyExperimental, featureEnabled, hostnameOf } from "../../app/core.ts";
import {
  formatCountdown,
  KEEP_ALIVE_MINUTES,
  keepAliveUrlFromInput,
  markKeepAlive,
  nextReloadAt,
  setKeepAliveMinutes,
  setKeepAliveUrl,
} from "../../app/keep-alive.ts";
import {
  clearKeepAlive,
  loadState,
  localStore,
  pauseKeepAlive,
  removeKeepAlive,
  restoreKeepAlive,
} from "../../app/storage.ts";
import { popRemoval } from "../../app/removal-trash.ts";
import type { AppState, KeepAliveRemoval, KeepAliveTab } from "../../app/types.ts";
import { getElementById } from "../../lib/dom.ts";
import { inlineEdit } from "../../lib/ui/inline-edit.ts";
import { flashSaved, getFeatures, render } from "./page-state.ts";

function option(value: number): HTMLOptionElement {
  const element = document.createElement("option"); // not `new Option()`: happy-dom lacks the constructor
  element.value = element.textContent = String(value);
  return element;
}

function minuteOptions(select: HTMLSelectElement): void {
  for (const minutes of KEEP_ALIVE_MINUTES) {
    select.append(option(minutes));
  }
}

export async function renderKeepAlive(state: AppState): Promise<void> {
  const features = applyExperimental(getFeatures(), state.ui.showExperimental ?? false);
  const section = getElementById("keep-alive-section");
  section.hidden = !featureEnabled(features, "KEEP_ALIVE");
  if (section.hidden) {
    return;
  }
  getElementById("keep-alive-body").hidden = !state.settings.keepAliveEnabled;
  const { keepAlive = [], keepAliveTrash = [] } = await localStore.get(["keepAlive", "keepAliveTrash"]);
  renderRestore(keepAliveTrash);
  const rows = getElementById("keep-alive-rows");
  rows.textContent = "";
  if (keepAlive.length === 0) {
    const cell = document.createElement("td");
    cell.className = "muted";
    cell.colSpan = 6;
    cell.textContent = "No tabs marked yet.";
    const empty = document.createElement("tr");
    empty.append(cell);
    rows.append(empty);
  }
  keepAlive.forEach((entry, index) => {
    rows.append(keepAliveRow(keepAlive, entry, index + 1));
  });
  tickCountdowns();
}

// "Restore last removal (N marks)" — only while an action exists; hovering lists what
// comes back, capped so a Remove all of hundreds does not become a screen-high tooltip
const TOOLTIP_URLS = 10;
function renderRestore(trash: KeepAliveRemoval[]): void {
  const button = getElementById<HTMLButtonElement>("restore-keep-alive");
  const newest = popRemoval(trash)?.newest;
  button.hidden = !newest;
  if (newest) {
    const count = newest.items.length;
    button.textContent = `Restore last removal (${count} mark${count === 1 ? "" : "s"})`;
    const urls = newest.items.slice(0, TOOLTIP_URLS).map((entry) => entry.url);
    button.title = ["Restore:", ...urls, ...(count > TOOLTIP_URLS ? ["…"] : [])].join("\n");
  }
}

// every row edit goes through one writer: skip the write when nothing changed
async function save(next: KeepAliveTab[] | undefined): Promise<void> {
  if (!next) {
    return;
  }
  await localStore.set({ keepAlive: next });
  flashSaved();
  render();
}

function cell(...children: (Node | string)[]): HTMLTableCellElement {
  const element = document.createElement("td");
  element.append(...children);
  return element;
}

// the Page cell (title + address) is editable in place — click anywhere in it and the
// address becomes an input (lib/ui/inline-edit): the only way to add a fragment to a
// mark made from a tab. Blur / Enter commit, Escape cancels; the table re-renders
// either way so an ignored value snaps back to the stored url
function pageCell(list: KeepAliveTab[], entry: KeepAliveTab): HTMLTableCellElement {
  const url = document.createElement("span");
  url.className = "url";
  url.textContent = entry.url;
  const page = cell(entry.title, url);
  page.title = `${entry.url}\nClick to edit the address`; // the cell clips long addresses to one line
  page.addEventListener("click", () => {
    if (page.querySelector(".rename-input")) {
      return; // a click inside the open editor
    }
    inlineEdit(url, {
      initial: entry.url,
      placeholder: "https://app.example.com/board",
      commit: async (value) => {
        const next = setKeepAliveUrl(list, entry.url, keepAliveUrlFromInput(value));
        if (next) {
          await localStore.set({ keepAlive: next });
          flashSaved();
        }
      },
      finish: render,
    });
  });
  return page;
}

function keepAliveRow(list: KeepAliveTab[], entry: KeepAliveTab, number: number): HTMLTableRowElement {
  const running = document.createElement("input");
  running.type = "checkbox";
  running.checked = !entry.paused;
  running.title = "Reload this page on its timer";
  running.addEventListener("change", async () => {
    if (await pauseKeepAlive([entry.url], !running.checked)) {
      flashSaved();
      render();
    }
  });

  const select = document.createElement("select");
  minuteOptions(select);
  select.value = String(entry.minutes);
  select.addEventListener("change", () => {
    const minutes = Number(select.value);
    save(setKeepAliveMinutes(list, entry.url, minutes, nextReloadAt(minutes, Date.now())));
  });

  const countdown = document.createElement("span");
  countdown.className = "countdown";
  countdown.dataset.nextReload = entry.paused ? "" : String(entry.nextReload);

  const remove = document.createElement("button");
  remove.textContent = "Remove";
  remove.title = `Remove the keep-alive mark for ${entry.title}`;
  remove.addEventListener("click", async () => {
    if (await removeKeepAlive([entry.url])) {
      flashSaved();
      render();
    }
  });

  const row = document.createElement("tr");
  row.append(cell(String(number)), cell(running), pageCell(list, entry), cell(select), cell(countdown), cell(remove));
  return row;
}

// the countdown cells carry their due time; one timer repaints them all
function tickCountdowns(): void {
  const now = Date.now();
  for (const element of document.querySelectorAll<HTMLElement>("#keep-alive-rows .countdown")) {
    const nextReload = element.dataset.nextReload ?? "";
    element.textContent = nextReload === "" ? "paused" : formatCountdown(Number(nextReload), now);
  }
}

// Add row: a page not open anywhere (or a future one) marked by typing its address;
// the mark takes the Default value like a menu mark would, and the hostname
// stands in for the title no tab has reported yet. Junk stays in the input.
async function addTypedMark(): Promise<void> {
  const input = getElementById<HTMLInputElement>("new-keep-alive");
  const url = keepAliveUrlFromInput(input.value);
  if (url === "") {
    return;
  }
  const [{ settings }, { keepAlive = [] }] = await Promise.all([loadState(), localStore.get("keepAlive")]);
  const minutes = settings.keepAliveMinutes;
  await save(markKeepAlive(keepAlive, [{ url, title: hostnameOf(url) }], minutes, nextReloadAt(minutes, Date.now())));
  input.value = "";
}

// the whole list in one go (paused marks too) — the per-row Remove gets tedious past a few
async function clearAllMarks(): Promise<void> {
  const { keepAlive = [] } = await localStore.get("keepAlive");
  if (keepAlive.length === 0 || !confirm("Remove ALL keep-alive marks? You can restore them afterwards.")) {
    return;
  }
  if (await clearKeepAlive()) {
    flashSaved();
    render();
  }
}

async function restoreLastRemoval(): Promise<void> {
  if (await restoreKeepAlive()) {
    flashSaved();
    render();
  }
}

export function initKeepAlive(): void {
  // the default-interval choices are static — filled once, before the first render sets the value
  minuteOptions(getElementById<HTMLSelectElement>("keepAliveMinutes"));
  getElementById("add-keep-alive").addEventListener("click", addTypedMark);
  getElementById("clear-keep-alive").addEventListener("click", clearAllMarks);
  getElementById("restore-keep-alive").addEventListener("click", restoreLastRemoval);
  setInterval(tickCountdowns, 1000);
}
