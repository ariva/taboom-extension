// `node demo/record.ts [--scene <id>]... [--stills all|features|readme] [--out dist/demo]` —
// builds the world, plays the scenes, films them. Every run starts from a fresh profile; a
// `--scene` run retakes only those scenes and leaves the other takes on disk for encode.sh.
// `--stills` films nothing and writes no scenes.json: the stills of the feature scenes, of the
// stills-only scenes (the README screenshots), or of both.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildWorld, launch, openAside, openPanel, SETTINGS_VIEWPORT, STORY_URL, STORY_VIEWPORT } from "./browser.ts";
import { buildTabs, WINDOWS } from "./fixture.ts";
import { Recorder, type Stream } from "./recorder.ts";
import { GIF_MAX_SECONDS, orderedForRelease, type Scene, SCENES } from "./scenes/index.ts";
import { installOverlay, makeStage, storyScene } from "./stage.ts";
import { storyHtml } from "./story.ts";

const { values } = parseArgs({
  options: {
    scene: { type: "string", multiple: true },
    stills: { type: "string" },
    out: { type: "string", default: "dist/demo" },
    extension: { type: "string", default: "dist/prod" },
  },
});

const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
const outDir = resolve(values.out ?? "dist/demo", version);
const extensionDir = resolve(values.extension ?? "dist/prod");
if (!existsSync(join(extensionDir, "manifest.json"))) {
  throw new Error(`${extensionDir} holds no built extension — run \`just build\` or \`npx vite build\` first`);
}
mkdirSync(outDir, { recursive: true });
const log = (line: string) => console.log(`[demo] ${line}`);

// An unpacked extension wears the "DEV ·" prefix (src/app/env.ts: no update_url in the
// manifest). The recording shows the store look: a copy of the build with an update_url —
// Chromium never calls it, background networking is off.
const stagedExtension = join(outDir, "extension");
rmSync(stagedExtension, { recursive: true, force: true });
cpSync(extensionDir, stagedExtension, { recursive: true });
const manifestFile = join(stagedExtension, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<string, unknown>;
writeFileSync(
  manifestFile,
  JSON.stringify({ ...manifest, update_url: "https://clients2.google.com/service/update2/crx" }, null, 2),
);

const stillsKind = values.stills;
if (stillsKind !== undefined && !["all", "features", "readme"].includes(stillsKind)) {
  throw new Error(`--stills ${stillsKind}: expected all, features or readme`);
}
const stillsOf = (scene: Scene) =>
  stillsKind === "features" ? !scene.stillsOnly : stillsKind === "readme" ? scene.stillsOnly === true : true;
const wanted = values.scene ?? [];
const scenes = orderedForRelease(version)
  .filter((scene) => wanted.length === 0 || wanted.includes(scene.id))
  .filter(stillsOf);
const unknown = wanted.filter((id) => !SCENES.some((scene) => scene.id === id));
if (unknown.length > 0) {
  throw new Error(`unknown scene(s): ${unknown.join(", ")} — known: ${SCENES.map((scene) => scene.id).join(", ")}`);
}

const tabs = buildTabs();

const started = Date.now();
const browser = await launch(stagedExtension, tabs, new Map([[STORY_URL, storyHtml(version)]]));
try {
  log(`extension ${browser.extensionId}, building ${tabs.length} tabs in ${WINDOWS.length} windows`);
  const world = await buildWorld(browser, tabs, log);
  const panel = await openPanel(browser);
  const story = await openAside(browser, STORY_URL, STORY_VIEWPORT);
  const settingsUrl = `chrome-extension://${browser.extensionId}/options/index.html`;
  const settings = await openAside(browser, settingsUrl, SETTINGS_VIEWPORT);
  const hidden = {
    tabIds: [world.panelTabId, story.tabId, settings.tabId],
    windowIds: [world.panelWindowId, story.windowId, settings.windowId],
  };
  const streamOfUrl = (url: string): Stream | undefined => {
    if (url === STORY_URL) {
      return "story";
    }
    return url === settingsUrl ? "settings" : undefined;
  };
  // Playwright dismisses native confirm() dialogs by default — the panel's bulk confirmations
  // (Cleanup Duplicates, closing several tabs) must go through
  panel.on("dialog", (dialog) => {
    dialog.accept().catch(() => {});
  });
  await panel.waitForTimeout(1500); // names, badges and counts settle
  // a Set does not survive evaluate's serialization: the worker hands back an array
  const activeUrls = async () =>
    new Set(
      await browser.worker.evaluate(async () =>
        (await chrome.tabs.query({ active: true })).map((tab) => tab.url ?? ""),
      ),
    );
  const recorder = new Recorder(browser.context, outDir, streamOfUrl, activeUrls);
  await recorder.start(panel, log);
  const stillsDir = join(outDir, "features");
  mkdirSync(stillsDir, { recursive: true });
  const stage = makeStage(panel, browser.worker, world, { story: story.page, settings: settings.page }, log, stillsDir);
  const takes: {
    id: string;
    title: string;
    durationMs: number;
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
    if (filmed) {
      await recorder.startScene(scene.id);
    }
    try {
      await storyScene(stage.aside, scene.title);
      await stage.settings(scene.settings);
      await scene.run(stage);
    } catch (error) {
      log(
        `scene ${scene.id} failed: ${error instanceof Error ? (error.stack ?? error.message).split("\n").slice(0, 4).join(" ⏎ ") : String(error)}`,
      );
    }
    if (filmed) {
      takes.push({
        ...recorder.endScene(),
        title: scene.title,
        stills: [...stage.stills],
        ...(scene.gif ? { gif: scene.gif } : {}),
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
    // an earlier take keeps its film and length; title, GIF clip and release mark follow the registry
    const merged = orderedForRelease(version)
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
          title: scene.title,
          ...(scene.gif ? { gif: scene.gif } : {}),
          ...(scene.newIn ? { newIn: scene.newIn } : {}),
        };
      })
      .filter((take): take is (typeof takes)[number] => take !== undefined);
    const gifSeconds = merged.reduce((sum, take) => sum + (take.gif ? take.gif[1] - take.gif[0] : 0), 0);
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
