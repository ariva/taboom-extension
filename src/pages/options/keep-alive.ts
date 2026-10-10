// Keep-tabs-alive card: the default-interval dropdown and the table of marks —
// numbered, each with its pause checkbox, own interval, a live countdown to the
// next reload and Remove. The enable checkbox and default interval are
// settings — settings-form.ts persists them; this module only shows / hides.
import { applyExperimental, featureEnabled } from "../../app/core.ts";
import { formatCountdown, KEEP_ALIVE_MINUTES, nextReloadAt, setKeepAliveMinutes } from "../../app/keep-alive.ts";
import { localStore, pauseKeepAlive, removeKeepAlive } from "../../app/storage.ts";
import type { AppState, KeepAliveTab } from "../../app/types.ts";
import { getElementById } from "../../lib/dom.ts";
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
  const { keepAlive = [] } = await localStore.get("keepAlive");
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

  const url = document.createElement("span");
  url.className = "url";
  url.textContent = entry.url;

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
  row.append(cell(String(number)), cell(running), cell(entry.title, url), cell(select), cell(countdown), cell(remove));
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

export function initKeepAlive(): void {
  // the default-interval choices are static — filled once, before the first render sets the value
  minuteOptions(getElementById<HTMLSelectElement>("keepAliveMinutes"));
  setInterval(tickCountdowns, 1000);
}
