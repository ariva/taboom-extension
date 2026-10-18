// One auto-snooze pass on demand (Settings button, ☰ quick action): asks the worker
// and words the outcome — both pages show the same status line.
import { send } from "./messages.ts";

export async function snoozeInactiveNow(): Promise<string> {
  const response = await send({ type: "snooze-all-inactive" });
  // undefined: no listener answered
  if (!response || "error" in response) {
    return "Snooze failed";
  }
  return response.snoozed === 1 ? "Snoozed 1 tab" : `Snoozed ${response.snoozed} tabs`;
}
