// Imperative shell: DOM + chrome.* effects only. All list/view logic lives in
// model.js as pure functions; this file feeds them state and applies the results.

// lib/ui modules register their document/window listeners when first evaluated —
// i.e. here, before anything else pulls them in. Keep dropdown ahead of
// context-menu: both listen to window "blur" and that was their original order.
import { attachDropdown } from "../../lib/ui/dropdown.ts";
import "../../lib/ui/context-menu.ts";
import "../../lib/ui/ask-dialog.ts";
import "../../lib/ui/inline-edit.ts";
import { loadFeatures, loadState } from "../../app/storage.ts";
import { DEV_PREFIX, getAppName, getReleaseVersion, markDevPage } from "../../app/env.ts";
import { scopeSelect, sortSelect } from "./foundation/elements.ts";
import { state } from "./foundation/state.ts";
// The data + render half of the panel. Several of these modules register listeners
// when first evaluated — i.e. here, before this file's top-level code (and before its
// top-level await). Every one of them is either the only listener for its target +
// event type, or was already registered ahead of the listeners wired by the init*()
// calls below (listEl "scroll": hover tip, then the ctx-menu hide; chrome.storage.onChanged:
// live-updates first) — so the order among these imports does not matter.
import { refresh, registerPanel } from "./foundation/scheduler.ts";
import { refresh as refreshImpl } from "./render/data.ts";
import { render as renderImpl } from "./render/render.ts";
import { initListEvents } from "./input/list-events.ts";
import { initBulkButtons } from "./input/toolbar-events.ts";
import { initKeyboardNav } from "./input/keyboard-nav.ts";
import { initQuickActions } from "./input/quick-actions.ts";
import { initialDirFor } from "./render/sorting.ts";
import "./input/live-updates.ts";
// The feature modules register nothing when evaluated: each wires its listeners in an
// init*() called below, in the order (and at the time — after the top-level await) this
// file used to register them. Their import order therefore does not matter.
import { initWindowsPopover } from "./windows-popover/popover.ts";
import { initGroupReorder } from "./windows-popover/groups.ts";
import { initTabDnd } from "./dnd/tab-dnd.ts";
import { initListContextMenu } from "./menus/list-context-menu.ts";
import { initGlobalKeys } from "./input/global-keys.ts";
import { initUpdateBanner } from "./banners/update-banner.ts";
import { initHistoryNav } from "./history/history-nav.ts";
import { initRestoreBanner } from "./banners/restore-banner.ts";

// before anything can fire: the moved modules' listeners are live from import time and
// reach render()/refresh() through the scheduler
registerPanel({ render: renderImpl, refresh: refreshImpl });

markDevPage();
// state read races the features fetch instead of queuing behind the top-level await
const initialStatePromise = loadState();
const FEATURES = await loadFeatures();
state.features = FEATURES; // state.ts cannot await the flags itself — see its `features` note
state.rawFeatures = FEATURES;

// the toolbar <select>s open the custom list instead of the (mispositioned) native popup
for (const ddSelect of [scopeSelect, sortSelect]) {
  attachDropdown(ddSelect);
}

// Listener registration order = the order of these calls (same target + phase fire in
// registration order): document "click" — popover click-away after lib/ui's ctx-menu hide;
// document "keydown" — the capture-phase Escape (global-keys) ahead of keyboard-nav;
// window "blur" — dropdown, ctx menu, then history-nav's popover close;
// chrome.storage.onChanged — live-updates, update banner, then history-nav's two.
initWindowsPopover();
initGroupReorder();

// list click delegation (list-events.ts)
initListEvents();

initTabDnd();
initListContextMenu();
initGlobalKeys();

// ---------- events ----------

// wired here, at their original spot in the listener order (toolbar-events.ts, keyboard-nav.ts)
initBulkButtons();
initKeyboardNav();
initQuickActions();

// ---------- init ----------

function initHeading(prefix: string): void {
  // static markup: the panel has one <h1>
  document.querySelector("h1")!.title = `${prefix}${getAppName()} v${getReleaseVersion()}`;
}

initHeading(DEV_PREFIX);

initialStatePromise.then((persisted) => {
  state.filter = persisted.ui.defaultFilter;
  state.scope = persisted.ui.scope;
  state.sort = persisted.ui.sort;
  state.ui = persisted.ui; // initialDirFor reads sortDirMode/sortDirections
  state.sortDir = initialDirFor(state.sort);
  scopeSelect.value = state.scope;
  sortSelect.value = state.sort;
  refresh(false, persisted); // search input focuses itself via the autofocus attribute
});

initUpdateBanner();
initHistoryNav();
initRestoreBanner();
