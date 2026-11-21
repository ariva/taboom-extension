// The two columns a temporary protection rule or keep-alive mark adds to its Settings table
// (T-0157): an Expires dropdown (Never + the durations; a pick re-bases from now, the caller
// writes it) and a Time left cell the countdown timer repaints.
import { EXPIRY_CHOICES, expiryAt, expiryChoiceFor, formatTimeLeft } from "../../app/expiry.ts";

export const NEVER = ""; // the dropdown's value for a permanent entry

export function expirySelect(
  expiresAt: number | undefined,
  label: string,
  onPick: (expiresAt: number | undefined) => void,
): HTMLSelectElement {
  const select = document.createElement("select");
  for (const [value, text] of [
    [NEVER, "Never"],
    ...EXPIRY_CHOICES.map((choice) => [String(choice.hours), choice.label]),
  ]) {
    const option = document.createElement("option"); // not `new Option()`: happy-dom lacks the constructor
    option.value = value ?? NEVER;
    option.textContent = text ?? "";
    select.append(option);
  }
  const now = Date.now();
  select.value = expiresAt === undefined ? NEVER : String(expiryChoiceFor(expiresAt, now));
  select.setAttribute("aria-label", `Expires for ${label}`);
  select.title =
    "Never: permanent. A duration counts from now; the entry is removed when it ends (Restore last removal brings it back)";
  select.addEventListener("change", () => {
    onPick(select.value === NEVER ? undefined : expiryAt(Number(select.value), Date.now()));
  });
  return select;
}

// "5h 40m" / "—": carries its time for tickTimeLeft (keep-alive.ts runs the one timer)
export function timeLeftCell(expiresAt: number | undefined): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.className = "time-left";
  cell.dataset.expiresAt = expiresAt === undefined ? "" : String(expiresAt);
  cell.textContent = expiresAt === undefined ? "—" : formatTimeLeft(expiresAt, Date.now());
  return cell;
}

// every Time left cell on the page, both tables
export function tickTimeLeft(now: number): void {
  for (const cell of document.querySelectorAll<HTMLElement>(".time-left[data-expires-at]")) {
    const expiresAt = cell.dataset.expiresAt ?? "";
    cell.textContent = expiresAt === "" ? "—" : formatTimeLeft(Number(expiresAt), now);
  }
}
