// `node demo/record.ts [--scene <id>]... [--stills all|features|readme] [--out dist/demo] [--browser chrome|firefox]`
// — builds the world, plays the scenes, films them. Every run starts from a fresh profile; a
// `--scene` run retakes only those scenes and leaves the other takes on disk for encode.sh.
// `--stills` films nothing and writes no scenes.json: the stills of the feature scenes, of the
// stills-only scenes (the README screenshots), or of both.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildWorld, launch, PANEL_VIEWPORT, SETTINGS_VIEWPORT, STORY_URL, STORY_VIEWPORT } from "./browser.ts";
import { buildTabs, WINDOWS } from "./fixture.ts";
import type { BrowserName, Stream } from "./page-api.ts";
import {
  CHECKLIST_MS,
  checklist,
  GIF_MAX_SECONDS,
  orderedForRelease,
  releaseMark,
  type Scene,
  SCENES,
  sceneHeading,
  shiftedGif,
} from "./scenes/index.ts";
import { installOverlay, makeStage, storyChecklist, storyScene } from "./stage.ts";
import { documentOf, missingStreams, streamOfUrl } from "./streams.ts";
import { storyHtml } from "./story.ts";
import { featureRelease } from "../src/app/release-highlights.ts";

const { values } = parseArgs({
  options: {
    scene: { type: "string", multiple: true },
    stills: { type: "string" },
    out: { type: "string", default: "dist/demo" },
    extension: { type: "string" },
    browser: { type: "string", default: "chrome" },
  },
});

if (values.browser !== "chrome" && values.browser !== "firefox") {
  throw new Error(`--browser ${values.browser}: expected chrome or firefox`);
}
const browserName: BrowserName = values.browser;
const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
// one take folder per browser: dist/demo/<version>-chrome, dist/demo/<version>-firefox
const outDir = resolve(values.out ?? "dist/demo", `${version}-${browserName}`);
const extensionDir = resolve(values.extension ?? (browserName === "firefox" ? "dist/firefox" : "dist/chrome"));
if (!existsSync(join(extensionDir, "manifest.json"))) {
  throw new Error(`${extensionDir} holds no built extension — run \`just build\` or \`npx vite build\` first`);
}
mkdirSync(outDir, { recursive: true });
const log = (line: string) => console.log(`[demo] ${line}`);

const stillsKind = values.stills;
if (stillsKind !== undefined && !["all", "features", "readme"].includes(stillsKind)) {
  throw new Error(`--stills ${stillsKind}: expected all, features or readme`);
}
const stillsOf = (scene: Scene) =>
  stillsKind === "features" ? !scene.stillsOnly : stillsKind === "readme" ? scene.stillsOnly === true : true;
const wanted = values.scene ?? [];
// a fixes-only release has nothing of its own to open with: the film keeps presenting the last
// release that had features as the new one
const featured = featureRelease(version);
const scenes = orderedForRelease(featured)
  .filter((scene) => wanted.length === 0 || wanted.includes(scene.id))
  .filter(stillsOf);
const unknown = wanted.filter((id) => !SCENES.some((scene) => scene.id === id));
if (unknown.length > 0) {
  throw new Error(`unknown scene(s): ${unknown.join(", ")} — known: ${SCENES.map((scene) => scene.id).join(", ")}`);
}

const tabs = buildTabs();

const started = Date.now();
const browser = await launch(extensionDir, tabs, new Map([[STORY_URL, storyHtml(version)]]), browserName, log);
try {
  log(
    `${browserName}: extension ${browser.extensionOrigin}, building ${tabs.length} tabs in ${WINDOWS.length} windows`,
  );
  const world = await buildWorld(browser, tabs, log);
  const panel = await browser.openPanel();
  await panel.setViewportSize(PANEL_VIEWPORT);
  const story = await browser.openAside(STORY_URL, STORY_VIEWPORT);
  const settingsUrl = `${browser.extensionOrigin}/options/index.html`;
  const settings = await browser.openAside(settingsUrl, SETTINGS_VIEWPORT);
  const hidden = {
    tabIds: [world.panelTabId, story.tabId, settings.tabId],
    windowIds: [world.panelWindowId, story.windowId, settings.windowId],
  };
  const paneOfUrl = (url: string): Stream | undefined => streamOfUrl(url, { story: STORY_URL, settings: settingsUrl });
  await panel.waitForTimeout(1500); // names, badges and counts settle
  // a Set does not survive evaluate's serialization: the worker hands back an array
  // (and with fragments removed: the recorders compare pages as documents — streams.ts)
  const activeUrls = async () => {
    const urls = await browser.worker.evaluate(async () =>
      (await chrome.tabs.query({ active: true })).map((tab) => tab.url ?? ""),
    );
    return new Set(urls.map(documentOf));
  };
  const recorder = browser.recorder(outDir, paneOfUrl, activeUrls);
  await recorder.start(panel, log);
  if (stillsKind === undefined) {
    // Right after the world is built the panes may not have painted yet: such a page answers no
    // opening still and sends no frame, and the film's first seconds — the feature list — would
    // show the pane as it was. A screenshot waits until the page can paint.
    await story.page.screenshot({ path: join(outDir, "warm-up.png") });
    await panel.screenshot({ path: join(outDir, "warm-up.png") });
  }
  const stillsDir = join(outDir, "features");
  mkdirSync(stillsDir, { recursive: true });
  const stage = makeStage(panel, browser, world, { story: story.page, settings: settings.page }, log, stillsDir);
  const takes: {
    id: string;
    title: string;
    durationMs: number;
    leadMs?: number; // the feature checklist the take opens with (absent: a take from before it existed)
    streams: Stream[];
    stills: string[];
    gif?: [number, number];
    newIn?: string;
    warnings?: string[];
  }[] = [];
  for (const scene of scenes) {
    log(`scene ${scene.id}`);
    await installOverlay(panel, hidden);
    stage.warnings.length = 0;
    stage.stills.length = 0;
    const filmed = !scene.stillsOnly && stillsKind === undefined;
    const list = checklist(featured, scene.id);
    const takeStarted = Date.now();
    if (filmed) {
      // the feature list is on the pane before the take starts, so the take's opening still is the list
      await storyChecklist(stage.aside, list);
      await recorder.startScene(scene.id);
    }
    stage.release = releaseMark(scene.newIn, featured);
    let leadMs = 0;
    try {
      if (filmed) {
        // CHECKLIST_MS from the take's first frame, not on top of what starting the take cost
        await stage.pause(Math.max(0, CHECKLIST_MS - (Date.now() - takeStarted)));
        await storyChecklist(stage.aside, null);
        leadMs = Date.now() - takeStarted;
      }
      const place = scene.feature ? `${Math.min(list.done + 1, list.total)} / ${list.total}` : "";
      await storyScene(stage.aside, sceneHeading(scene, featured), place);
      await stage.settings(scene.settings);
      await scene.run(stage);
    } catch (error) {
      log(
        `scene ${scene.id} failed: ${error instanceof Error ? (error.stack ?? error.message).split("\n").slice(0, 4).join(" ⏎ ") : String(error)}`,
      );
    }
    if (filmed) {
      const ended = recorder.endScene();
      const missing = missingStreams(ended.streams);
      if (missing.length > 0) {
        stage.check(
          false,
          `${scene.id}: no frames of ${missing.join(", ")} — that pane will be a dark tile in the film`,
        );
      }
      takes.push({
        ...ended,
        leadMs,
        title: sceneHeading(scene, featured),
        stills: [...stage.stills],
        ...(scene.gif ? { gif: shiftedGif(scene.gif, leadMs) } : {}),
        ...(scene.newIn ? { newIn: scene.newIn } : {}),
        ...(stage.warnings.length > 0 ? { warnings: [...stage.warnings] } : {}),
      });
    }
    // scenes that focus other windows move the panel's notion of "current": back to its own
    await browser.worker
      .evaluate((id) => chrome.windows.update(id, { focused: true }), world.panelWindowId)
      .catch(() => {});
    const take = takes[takes.length - 1];
    const film =
      !filmed || !take ? "not filmed" : `${(take.durationMs / 1000).toFixed(1)} s, streams: ${take.streams.join(" ")}`;
    log(
      `  ${film}${recorder.hidden.length > 0 ? ` (hidden: ${recorder.hidden.join(" ")})` : ""}${stage.stills.length > 0 ? `, stills: ${stage.stills.join(" ")}` : ""}`,
    );
    recorder.hidden = [];
  }
  if (stillsKind !== undefined) {
    log("stills only: scenes.json untouched");
  } else {
    // the timeline encode.sh reads: full registry order, with what this run took and what an
    // earlier run left on disk
    const manifestPath = join(outDir, "scenes.json");
    const previous: typeof takes = existsSync(manifestPath)
      ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { scenes: typeof takes }).scenes
      : [];
    // an earlier take keeps its film, its length and its lead; title, GIF clip (moved past that
    // take's own lead) and release mark follow the registry
    const merged = orderedForRelease(featured)
      .map((scene) => {
        const take =
          takes.find((candidate) => candidate.id === scene.id) ??
          previous.find((candidate) => candidate.id === scene.id);
        if (!take) {
          return undefined;
        }
        const { gif: _gif, newIn: _newIn, ...kept } = take;
        return {
          ...kept,
          title: sceneHeading(scene, featured),
          ...(scene.gif ? { gif: shiftedGif(scene.gif, take.leadMs) } : {}),
          ...(scene.newIn ? { newIn: scene.newIn } : {}),
        };
      })
      .filter((take): take is (typeof takes)[number] => take !== undefined);
    const gifSeconds = Math.round(merged.reduce((sum, take) => sum + (take.gif ? take.gif[1] - take.gif[0] : 0), 0));
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ version, recordedAt: new Date().toISOString(), gifSeconds, scenes: merged }, null, 2)}\n`,
    );
    log(`wrote ${manifestPath}; GIF clips total ${gifSeconds} s (budget ${GIF_MAX_SECONDS} s)`);
  }
} finally {
  if (browser.blocked.length > 0) {
    log(`blocked ${browser.blocked.length} network request(s): ${browser.blocked.slice(0, 5).join(", ")}`);
  }
  await browser.close();
  log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
