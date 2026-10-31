// Label → text input edit (Enter/blur commit, Esc cancels) plus the rule that a
// press which blurs an edit only ends the edit: that press's click is swallowed.
// The press/click state lives here and nowhere else.

// A press that blurs an inline edit only ENDS the edit — its click must not also
// act on whatever sits under it: a group row would navigate and close the windows
// popover, and near the popover's edge the release can land outside once the input
// is gone and read as a click-away. Armed by inlineEdit's blur while a press is in
// flight; spent by that click, or dropped by the next press when no click comes
// (the refill detached the pressed node).
let pressInFlight = false;
let swallowNextClick = false;
document.addEventListener(
  "mousedown",
  () => {
    pressInFlight = true;
    swallowNextClick = false;
  },
  true,
);
document.addEventListener("mouseup", () => (pressInFlight = false), true);
document.addEventListener(
  "click",
  (event) => {
    pressInFlight = false;
    if (swallowNextClick) {
      swallowNextClick = false;
      event.stopPropagation();
      event.preventDefault();
    }
  },
  true,
);

// swap `label` for a text input; Enter/blur commit (empty commits too), Esc
// cancels. `commit(value)` persists; `finish()` re-renders whatever hosts it.
// An event-driven re-render mid-edit rebuilds the host and ends the edit: Chrome fires
// blur on the removed input, and that blur must not save the half-typed value (the
// render that removed it already shows the stored one) — rename again, nothing lost.
export interface InlineEditOptions {
  initial: string;
  placeholder: string;
  commit: (value: string) => Promise<unknown> | void;
  finish: () => void;
}

export function inlineEdit(label: Element, { initial, placeholder, commit, finish }: InlineEditOptions): void {
  const input = document.createElement("input");
  input.className = "rename-input";
  input.value = initial;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder); // a label replaced by an input keeps a name
  input.addEventListener("click", (event) => event.stopPropagation()); // header click = collapse
  let cancelled = false;
  input.addEventListener("keydown", (event) => {
    event.stopPropagation(); // list keyboard nav / popover Esc must not fire mid-edit
    if (event.key === "Enter") {
      input.blur();
    }
    if (event.key === "Escape") {
      cancelled = true;
      input.blur();
    }
  });
  // the label may sit inside a <button> (quick launch rows): Blink runs the button's default
  // Space-keyup activation for the whole event path, stopPropagation or not — only
  // preventDefault keeps the row from "clicking" (popover closed, window focused) mid-rename;
  // the character itself was inserted on keydown, so nothing is lost
  input.addEventListener("keyup", (event) => {
    event.stopPropagation();
    if (event.key === " ") {
      event.preventDefault();
    }
  });
  input.addEventListener("blur", async () => {
    if (!input.isConnected) {
      return; // the host re-rendered under the edit: not a commit, and no finish — it is rendered already
    }
    swallowNextClick = pressInFlight; // blurred by a press: that click is spent on ending the edit
    input.classList.remove("rename-input"); // the edit is over: a host that leaves an open editor alone may rebuild on finish
    if (!cancelled) {
      await commit(input.value);
    }
    finish();
  });
  label.replaceWith(input);
  input.focus();
  input.select();
}
