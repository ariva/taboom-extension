// Auto-snooze settings form: fills the inputs from the stored settings and saves them
// on every change.
import { saveState } from "../../app/storage.ts";
import type { AppState, Settings } from "../../app/types.ts";
import { getElementById } from "../../lib/dom.ts";
import { clampedNumber } from "./model.ts";
import { flashSaved } from "./page-state.ts";

const SETTING_IDS: (keyof Settings)[] = [
  "autoSnoozeEnabled",
  "inactivityMinutes",
  "checkIntervalMinutes",
  "excludePinned",
  "excludeAudible",
  "minAwakePerWindow",
];

export function renderSettings(state: AppState): void {
  for (const id of SETTING_IDS) {
    const input = getElementById(id);
    if (input.type === "checkbox") {
      input.checked = Boolean(state.settings[id]);
    } else {
      input.value = String(state.settings[id]);
    }
  }
}

async function saveSettings() {
  const settings: Partial<Record<keyof Settings, boolean | number>> = {};
  for (const id of SETTING_IDS) {
    const input = getElementById(id);
    settings[id] = input.type === "checkbox" ? input.checked : clampedNumber(input.value, Number(input.min) || 0);
  }
  // as Settings: the loop fills every key (SETTING_IDS lists them all); checkbox
  // ids are the boolean settings and number inputs the numeric ones (index.html)
  await saveState({ settings: settings as Settings });
  flashSaved();
}

export function initSettingsForm(): void {
  for (const id of SETTING_IDS) {
    getElementById(id).addEventListener("change", saveSettings);
  }
}
