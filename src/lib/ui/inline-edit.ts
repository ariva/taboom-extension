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

// swap the header label for an input; Enter/blur commit, Esc cancels.
// An event-driven re-render mid-edit rebuilds the header and ends the edit —
// rare and harmless (rename again), not worth pausing renders for.
// swap `label` for a text input; Enter/blur commit (empty commits too), Esc
// cancels. `commit(value)` persists; `finish()` re-renders whatever hosts it.
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
  input.addEventListener("blur", async () => {
    swallowNextClick = pressInFlight; // blurred by a press: that click is spent on ending the edit
    if (!cancelled) {
      await commit(input.value);
    }
    finish();
  });
  label.replaceWith(input);
  input.focus();
  input.select();
}
