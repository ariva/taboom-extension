import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { test } from "vitest";

// the module builds its <dialog> at import time — the DOM globals come first
const win = new Window();
Object.assign(globalThis, { window: win, document: win.document, Event: win.Event, KeyboardEvent: win.KeyboardEvent });
const { askDialog, askDialogContains, isAskDialogOpen } = await import("../../../src/lib/ui/ask-dialog.ts");

// static lookups inside the dialog the widget just built — `as`: test-only narrowing
const dialog = document.getElementById("ask-dialog") as HTMLDialogElement;
const part = <T extends HTMLElement>(selector: string) => dialog.querySelector(selector) as T;

test("Lib - UI - Ask dialog - OK resolves true without an input and the input's value with one", async () => {
  const confirmed = askDialog({ message: "Close 12 tabs?", okLabel: "Close" });
  assert.equal(isAskDialogOpen(), true);
  assert.equal(part(".ask-message").textContent, "Close 12 tabs?");
  assert.equal(part(".ask-ok").textContent, "Close");
  assert.equal(part(".ask-cancel").textContent, "Cancel");
  assert.equal(dialog.querySelector(".ask-input"), null);
  part(".ask-ok").click();
  assert.equal(await confirmed, true);
  assert.equal(isAskDialogOpen(), false);

  const named = askDialog({ message: "New group name", input: { initial: "Work", placeholder: "Name" } });
  const field = part<HTMLInputElement>(".ask-input");
  assert.equal(field.value, "Work");
  assert.equal(field.placeholder, "Name");
  field.value = "Play";
  part(".ask-ok").click();
  assert.equal(await named, "Play");
});

test("Lib - UI - Ask dialog - Enter in the input confirms, an empty value included", async () => {
  const named = askDialog({ message: "Name", input: {} });
  part(".ask-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(await named, "");
  assert.equal(isAskDialogOpen(), false);
});

test("Lib - UI - Ask dialog - Cancel, a backdrop click and a bare close event (Esc) resolve null", async () => {
  const cancelled = askDialog({ message: "Sure?", input: { initial: "typed" } });
  part(".ask-cancel").click();
  assert.equal(await cancelled, null);

  const backdrop = askDialog({ message: "Sure?" });
  dialog.click(); // the backdrop belongs to the dialog element itself
  assert.equal(await backdrop, null);

  const escaped = askDialog({ message: "Sure?" });
  dialog.close(); // what the browser does on Esc
  assert.equal(await escaped, null);
});

test("Lib - UI - Ask dialog - A click inside the dialog keeps it open; contains() covers its parts only", async () => {
  const pending = askDialog({ message: "Sure?" });
  part(".ask-message").click();
  assert.equal(isAskDialogOpen(), true);
  assert.equal(askDialogContains(part(".ask-ok")), true);
  assert.equal(askDialogContains(document.body), false);
  assert.equal(askDialogContains(null), false);
  part(".ask-cancel").click();
  await pending;
});
