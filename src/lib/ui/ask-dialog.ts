// Generic modal confirm/prompt on a native <dialog> (#ask-dialog).

// generic modal (native <dialog>: top layer, focus trap, Esc for free) — a
// message plus an optional text input. Resolves the input's value (true when
// there is no input) on OK / Enter, null on Cancel / Esc / backdrop click.
//   await askDialog({ message: "Close 12 tabs?", okLabel: "Close" })      → true | null
//   await askDialog({ message: "New group name", input: {} })             → string | null
const askEl = document.createElement("dialog");
askEl.id = "ask-dialog";
document.body.append(askEl);
// the backdrop belongs to the dialog element — a click on it lands on askEl itself
askEl.addEventListener("click", (event) => {
  if (event.target === askEl) {
    cancelReason = "backdrop";
    askEl.close();
  }
});
// Esc: the native cancel event precedes the close
askEl.addEventListener("cancel", () => {
  cancelReason = "escape";
});

// focus left for another window / the page beside a side panel: the question is dropped
// (resolves null), like a popover menu closing on blur
window.addEventListener("blur", () => {
  if (askEl.open) {
    cancelReason = "blur";
    askEl.close();
  }
});

export function isAskDialogOpen(): boolean {
  return askEl.open;
}

// click-away guards: is this event target inside the dialog?
export function askDialogContains(target: Node | null): boolean {
  return askEl.contains(target);
}

export interface AskDialogOptions {
  message: string;
  input?: { initial?: string; placeholder?: string } | null;
  okLabel?: string;
  cancelLabel?: string;
  // a checkbox under the message ("Don't ask again"); its state reaches the caller on OK only
  checkbox?: { label: string; onConfirm: (checked: boolean) => void } | null;
  // a row of color swatches under the input (a tag's color); the picked name reaches the caller on OK only
  swatches?: { colors: [name: string, hex: string][]; initial: string; onConfirm: (name: string) => void } | null;
  // OK / Enter runs it on the input's value: a message keeps the dialog open and shows under the
  // input (cleared on the next keystroke); undefined lets the dialog close
  validate?: ((value: string) => string | undefined) | null;
  // open at this point (a menu item's click) instead of the stylesheet's place, kept inside the window
  near?: Pick<MouseEvent, "clientX" | "clientY"> | null;
  // a corner ✕ (= Cancel), like the panel's pickers and menus
  closeButton?: boolean;
  // how a null result came about — the Cancel button or ✕ ("button"), Esc, the backdrop, or the
  // window losing focus — for callers that treat an explicit Cancel differently from a dismissal
  onCancel?: ((reason: "button" | "escape" | "backdrop" | "blur") => void) | null;
}

type CancelReason = "button" | "escape" | "backdrop" | "blur";
let cancelReason: CancelReason | null = null; // set by whoever closes the open dialog without a result

export function askDialog({
  message,
  input = null,
  okLabel = "OK",
  cancelLabel = "Cancel",
  checkbox = null,
  swatches = null,
  validate = null,
  near = null,
  closeButton = false,
  onCancel = null,
}: AskDialogOptions): Promise<string | true | null> {
  return new Promise((resolve) => {
    let result: string | true | null = null;
    cancelReason = null;
    const text = document.createElement("p");
    text.className = "ask-message";
    text.textContent = message;
    const field = input ? document.createElement("input") : null;
    const check = checkbox ? document.createElement("input") : null;
    const error = validate ? document.createElement("p") : null;
    if (error) {
      error.className = "ask-error";
      error.hidden = true;
    }
    let picked = swatches?.initial ?? "";
    const confirm = () => {
      const problem = validate?.(field?.value ?? "");
      if (problem && error) {
        error.textContent = problem;
        error.hidden = false;
        field?.focus();
        return; // stays open: the user fixes the value or cancels
      }
      result = field ? field.value : true;
      if (check) {
        checkbox?.onConfirm(check.checked);
      }
      if (swatches) {
        swatches.onConfirm(picked);
      }
      askEl.close();
    };
    let swatchRow: HTMLDivElement | null = null;
    if (swatches) {
      swatchRow = document.createElement("div");
      swatchRow.className = "ask-swatches";
      for (const [name, hex] of swatches.colors) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "ask-swatch";
        swatch.dataset.color = name;
        swatch.style.background = hex;
        swatch.title = swatch.ariaLabel = name[0]?.toUpperCase() + name.slice(1);
        swatch.setAttribute("aria-pressed", String(name === picked));
        swatch.addEventListener("click", () => {
          picked = name;
          for (const other of swatchRow?.children ?? []) {
            other.setAttribute("aria-pressed", String(other === swatch));
          }
        });
        swatchRow.append(swatch);
      }
    }
    let checkLabel: HTMLLabelElement | null = null;
    if (check) {
      check.type = "checkbox";
      check.className = "ask-check";
      checkLabel = document.createElement("label");
      checkLabel.className = "ask-check-label";
      checkLabel.append(check, checkbox?.label ?? "");
    }
    if (field) {
      field.className = "ask-input";
      field.value = input?.initial ?? "";
      field.placeholder = input?.placeholder ?? "";
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          confirm();
        }
      });
      field.addEventListener("input", () => {
        if (error) {
          error.hidden = true; // a new attempt starts clean
        }
      });
    }
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ask-cancel";
    cancel.textContent = cancelLabel;
    cancel.addEventListener("click", (event) => {
      event.stopPropagation(); // same: the click ends here
      cancelReason = "button";
      askEl.close();
    });
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "ask-ok";
    ok.textContent = okLabel;
    ok.addEventListener("click", confirm);
    const actions = document.createElement("div");
    actions.className = "ask-actions";
    actions.append(cancel, ok);
    let corner: HTMLButtonElement | null = null;
    if (closeButton) {
      corner = document.createElement("button");
      corner.type = "button";
      corner.className = "ask-close";
      corner.title = corner.ariaLabel = "Close";
      corner.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>'; // constant markup
      corner.addEventListener("click", (event) => {
        event.stopPropagation(); // a menu an onCancel brings back must not meet this click as a click-away
        cancelReason = "button";
        askEl.close();
      });
    }
    askEl.replaceChildren(
      ...(corner ? [corner] : []),
      text,
      ...(field ? [field] : []),
      ...(error ? [error] : []),
      ...(swatchRow ? [swatchRow] : []),
      ...(checkLabel ? [checkLabel] : []),
      actions,
    );
    // every exit — OK, Cancel, Esc, backdrop — funnels through the close event
    askEl.addEventListener(
      "close",
      () => {
        if (result === null) {
          onCancel?.(cancelReason ?? "escape");
        }
        resolve(result);
      },
      { once: true },
    );
    askEl.showModal();
    // measured after the show: a closed dialog has no size. Without `near` the stylesheet places it
    askEl.style.cssText = "";
    if (near && Number.isFinite(near.clientX) && Number.isFinite(near.clientY)) {
      askEl.style.position = "fixed";
      askEl.style.margin = "0";
      askEl.style.left = `${Math.max(4, Math.min(near.clientX, window.innerWidth - askEl.offsetWidth - 4))}px`;
      askEl.style.top = `${Math.max(4, Math.min(near.clientY, window.innerHeight - askEl.offsetHeight - 4))}px`;
    }
    (field ?? ok).focus();
  });
}
