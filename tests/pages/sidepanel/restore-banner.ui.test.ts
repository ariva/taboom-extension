// restore-banner.ts: the port that tells the worker this window has a panel, and its reconnect.
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { byId } from "../../helpers/dom.ts";
import { FIREFOX, loadPage, makeChrome, tick } from "../../helpers/ui.ts";

const calls: string[] = [];
const chrome = makeChrome({ calls, stored: {} });
Object.assign(globalThis, { chrome });

// every port the panel opens, so a test can drop one like an idle-killed worker does
const ports: ReturnType<typeof chrome.runtime.connect>[] = [];
const connect = chrome.runtime.connect;
chrome.runtime.connect = (info) => {
  const port = connect(info);
  ports.push(port);
  return port;
};

// what the worker answers to "which other windows had a panel": none, unless a test says so
let toRestore: number[] = [];
const sendMessage = chrome.runtime.sendMessage;
chrome.runtime.sendMessage = async (message: { type: string }) => {
  const answer = await sendMessage(message);
  return message.type === "panels-to-restore" ? { windows: toRestore } : answer;
};
loadPage("src/pages/sidepanel/index.html", chrome); // the banner's markup; the panel itself is not booted

const { initRestoreBanner } = await import("../../../src/pages/sidepanel/banners/restore-banner.ts");

test("Restore banner - the port reconnects at once when the worker goes away; a port that died within a second backs off", async () => {
  vi.useFakeTimers();
  try {
    initRestoreBanner();
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(ports.length, 1, "connected on load");
    assert.ok(calls.includes("runtime.connect sidepanel:1"));

    // a healthy session, then the worker is idle-killed: a panel opening in another window
    // right now asks the worker who has a panel — this window must already be back
    await vi.advanceTimersByTimeAsync(5_000);
    await ports[0]?.onDisconnect.fire();
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(ports.length, 2, "reconnected without a delay");

    // the new port dies at once (worker failing to start): wait a second, never spin
    await ports[1]?.onDisconnect.fire();
    await vi.advanceTimersByTimeAsync(999);
    assert.equal(ports.length, 2, "not yet");
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(ports.length, 3, "reconnected after the back-off");
  } finally {
    vi.useRealTimers();
  }
});

test("Restore banner - offered where a panel can be opened in another window", { skip: FIREFOX }, async () => {
  toRestore = [2, 3];
  calls.length = 0;
  initRestoreBanner();
  await tick();
  await tick();
  toRestore = [];
  assert.equal(byId("restore-banner").hidden, false);
  assert.equal(byId("restore-open").textContent, "Side panel was open in 2 other windows — restore?");
  assert.ok(!calls.includes("sendMessage panels-restore-dismiss"), "nothing forgotten before the user answers");
  byId("restore-banner").hidden = true;
});

// Firefox opens its sidebar in the active window only: an offer to reopen it in other windows
// could not be kept — no banner, and the windows are forgotten so they are not offered again
test("Restore banner - Firefox: no offer, the other windows are forgotten", { skip: !FIREFOX }, async () => {
  toRestore = [2, 3];
  calls.length = 0;
  initRestoreBanner();
  await tick();
  await tick();
  toRestore = [];
  assert.equal(byId("restore-banner").hidden, true);
  assert.ok(calls.includes("sendMessage panels-restore-dismiss"), `forgotten: ${calls.join(" | ")}`);
  assert.ok(!calls.some((call) => call.startsWith("sidebarAction.open")), "no sidebar opened on its own");
});
