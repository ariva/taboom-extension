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
}

export function askDialog({
  message,
  input = null,
  okLabel = "OK",
  cancelLabel = "Cancel",
}: AskDialogOptions): Promise<string | true | null> {
  return new Promise((resolve) => {
    let result: string | true | null = null;
    const text = document.createElement("p");
    text.className = "ask-message";
    text.textContent = message;
    const field = input ? document.createElement("input") : null;
    const confirm = () => {
      result = field ? field.value : true;
      askEl.close();
    };
    if (field) {
      field.className = "ask-input";
      field.value = input?.initial ?? "";
      field.placeholder = input?.placeholder ?? "";
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          confirm();
        }
      });
    }
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ask-cancel";
    cancel.textContent = cancelLabel;
    cancel.addEventListener("click", () => askEl.close());
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "ask-ok";
    ok.textContent = okLabel;
    ok.addEventListener("click", confirm);
    const actions = document.createElement("div");
    actions.className = "ask-actions";
    actions.append(cancel, ok);
    askEl.replaceChildren(text, ...(field ? [field] : []), actions);
    // every exit — OK, Cancel, Esc, backdrop — funnels through the close event
    askEl.addEventListener("close", () => resolve(result), { once: true });
    askEl.showModal();
    (field ?? ok).focus();
  });
}
