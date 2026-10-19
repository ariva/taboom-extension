// The composite's pane sizes live twice: the viewports the recorder films (demo/browser.ts)
// and the tile sizes encode.sh composes 1:1. A drift between the two scales a pane silently.
// The panel viewport is the app's 820 px plus the caption band below it (CAPTION_BAND), so
// captions never cover the panel; stills clip the band away and stay 600×820.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { CAPTION_BAND, DEVICE_SCALE, PANEL_VIEWPORT, SETTINGS_VIEWPORT, STORY_VIEWPORT } from "../../demo/browser.ts";

const encode = readFileSync("demo/encode.sh", "utf8");
const size = (name: string) => Number(encode.match(new RegExp(`${name}=(\\d+)`))?.[1]);

test("Demo - Layout - encode.sh composes every pane at its recorded viewport", () => {
  assert.deepEqual(
    { w: size("PANEL_W"), h: size("PANEL_H") },
    { w: PANEL_VIEWPORT.width, h: PANEL_VIEWPORT.height },
    "panel",
  );
  assert.deepEqual({ w: size("STORY_W"), h: size("STORY_H") }, { w: STORY_VIEWPORT.width, h: STORY_VIEWPORT.height });
  assert.deepEqual(
    { w: size("SETTINGS_W"), h: size("SETTINGS_H") },
    { w: SETTINGS_VIEWPORT.width, h: SETTINGS_VIEWPORT.height },
  );
});

test("Demo - Layout - the panel viewport is the 600×820 app plus the caption band", () => {
  assert.ok(CAPTION_BAND >= 56, "room for one or two caption lines");
  assert.deepEqual({ w: PANEL_VIEWPORT.width, h: PANEL_VIEWPORT.height - CAPTION_BAND }, { w: 600, h: 820 });
});

test("Demo - Layout - encode.sh composes at the device scale the recorder films at", () => {
  // the film is shot at DEVICE_SCALE (--force-device-scale-factor) for crisp text; the tiles
  // encode.sh cuts are the viewports times that scale, so SCALE must follow the flag
  const browser = readFileSync("demo/browser.ts", "utf8");
  assert.match(browser, /--force-device-scale-factor=\$\{DEVICE_SCALE\}/, "the flag takes DEVICE_SCALE");
  assert.equal(size("SCALE"), DEVICE_SCALE);
  assert.ok(DEVICE_SCALE >= 2, "a 1080p film needs more than 1:1 frames of the 1440 px canvas");
});
