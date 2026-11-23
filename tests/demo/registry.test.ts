// The demo recorder's scene registry (demo/scenes/index.ts): the "new in this release" scenes
// must cover every New Features bullet of the current CHANGES.md entry, ids are unique, the
// GIF clips fit the budget. Runs once (flag-independent).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
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
} from "../../demo/scenes/index.ts";
import { everythingElse, featureRelease, releaseHighlights } from "../../src/app/release-highlights.ts";

const packageVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
// what the film presents as new: this release, or the last one that had features (a fixes-only release)
const version = featureRelease(packageVersion);

// features the demo browser cannot run: Playwright's bundled Chromium (153) has no split view
// (Chrome 155+), so a scene would film nothing — exempt until that Chromium catches up, then
// the entry goes and the registry asks for the scene again
const NOT_FILMABLE_YET = [/\bsplit view\b/i];

// the top entry of CHANGES.md: its version and the bullets under "### New Features"
function currentNewFeatures(): { entryVersion: string | null; bullets: string[] } {
  // entries start with "## v<version>"; sections inside with "### "
  const [, first] = readFileSync("CHANGES.md", "utf8").split(/^## v/m);
  const entryVersion = first?.match(/^(\d+\.\d+\.\d+)/)?.[1] ?? null;
  const section = first?.split(/^### /m).find((part) => part.startsWith("New Features"));
  const bullets = (section ?? "")
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
  return { entryVersion, bullets };
}

test("Demo - Registry - scene ids are unique and every scene has a title", () => {
  const ids = SCENES.map((scene) => scene.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate scene id in ${ids.join(", ")}`);
  for (const scene of SCENES) {
    assert.ok(scene.title.length > 0, `${scene.id} has no title`);
    assert.match(scene.id, /^[a-z0-9-]+$/, `${scene.id}: ids are lowercase slugs`);
  }
});

test("Demo - Registry - the GIF clips fit the budget and lie inside their scene", () => {
  const total = SCENES.reduce((sum, scene) => sum + (scene.gif ? scene.gif[1] - scene.gif[0] : 0), 0);
  assert.ok(total <= GIF_MAX_SECONDS, `GIF clips total ${total} s, budget ${GIF_MAX_SECONDS} s`);
  for (const scene of SCENES) {
    if (scene.gif) {
      assert.ok(scene.gif[0] >= 0 && scene.gif[1] > scene.gif[0], `${scene.id}: gif clip ${scene.gif.join("-")}`);
    }
  }
});

test("Demo - Registry - the scenes marked new for the current release play first", () => {
  const ordered = orderedForRelease(version);
  const firstOld = ordered.findIndex((scene) => scene.newIn !== version);
  const lastNew = ordered.map((scene) => scene.newIn === version).lastIndexOf(true);
  assert.ok(firstOld === -1 || lastNew < firstOld, "a new-in-release scene plays after an old one");
});

test("Demo - Registry - the outro plays last, after the new-in-release reordering, and holds the final frame", () => {
  const ordered = orderedForRelease(version);
  const last = ordered[ordered.length - 1];
  assert.equal(last?.id, "finished", "the closing scene must stay last");
  assert.equal(last?.newIn, undefined, "an outro is never new in a release");
  assert.equal(last?.gif, undefined, "the GIF tour has no outro");
  assert.equal(last?.settings, "#page-title", "same screen as the end of the settings scene");
});

test("Demo - Registry - a stills-only scene is never filmed: no GIF clip, no release mark", () => {
  const stillsOnly = SCENES.filter((scene) => scene.stillsOnly);
  assert.ok(stillsOnly.length > 0, "the readme scene is stills-only");
  for (const scene of stillsOnly) {
    assert.equal(scene.gif, undefined, `${scene.id}: a GIF clip needs a film`);
    assert.equal(scene.newIn, undefined, `${scene.id}: it covers no release bullet`);
  }
});

test("Demo - Registry - every New Features bullet of the current CHANGES.md entry has a scene (experimental ones excepted)", () => {
  const { entryVersion, bullets } = currentNewFeatures();
  if (entryVersion !== version) {
    return; // the entry for this version is not written yet (/release-notes) — nothing to cover
  }
  // any scene may stand for a bullet (covers); newIn only decides which scenes play first.
  // A feature shipped behind "Show experimental features" is not filmed: the bullet says so
  const uncovered = bullets
    .filter((bullet) => !/\bexperimental\b/i.test(bullet))
    .filter((bullet) => !NOT_FILMABLE_YET.some((pattern) => pattern.test(bullet)))
    .filter((bullet) => !SCENES.some((scene) => scene.covers?.test(bullet)));
  assert.deepEqual(uncovered, [], `New Features of v${version} without a demo scene:\n- ${uncovered.join("\n- ")}`);
  for (const scene of SCENES.filter((scene) => scene.newIn === version)) {
    assert.ok(scene.covers, `${scene.id} is new in ${version} but names no bullet (covers)`);
  }
});

test("Demo - Registry - every scene names a Settings anchor that exists in the options page", () => {
  const html = readFileSync("src/pages/options/index.html", "utf8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const scene of SCENES) {
    assert.match(scene.settings, /^#[\w-]+$/, `${scene.id}: settings is an #id selector of options/index.html`);
    assert.ok(ids.has(scene.settings.slice(1)), `${scene.id}: ${scene.settings} is not in options/index.html`);
  }
});

test("Demo - Registry - a scene names its release relative to the recorded one: New in … for the current release, Since … after it; no scene hard-codes the words", () => {
  assert.equal(releaseMark("1.1.0", "1.1.0"), "New in 1.1.0");
  assert.equal(releaseMark("1.0.5", "1.1.0"), "Since 1.0.5");
  assert.equal(releaseMark(undefined, "1.1.0"), "");
  assert.equal(sceneHeading({ title: "Custom tags", newIn: "1.0.5" }, "1.1.0"), "Since 1.0.5 · Custom tags");
  assert.equal(sceneHeading({ title: "The tour" }, "1.1.0"), "The tour");
  for (const scene of SCENES) {
    assert.doesNotMatch(
      scene.title,
      /^New\b/i,
      `${scene.id}: the recorder prefixes the release mark, the title stays plain`,
    );
  }
  // index.ts holds the helper (and names the words in its comment); every scene module is checked
  for (const file of readdirSync("demo/scenes").filter((name) => name.endsWith(".ts") && name !== "index.ts")) {
    const source = readFileSync(join("demo/scenes", file), "utf8");
    assert.doesNotMatch(source, /"New in \d/, `${file}: captions open with \${stage.release}, never a literal release`);
  }
});

// ---------- the feature checklist shown before every scene ----------

const scene = (id: string, feature?: string, newIn?: string): Scene => ({
  id,
  title: id,
  settings: "#page-title",
  ...(feature ? { feature } : {}),
  ...(newIn ? { newIn } : {}),
  run: async () => {},
});
// registry order: the 2.0.0 scene is listed last but plays first
const SAMPLE = [
  scene("search", "Search and filters"),
  scene("filters", "Search and filters"),
  scene("tags", "Tags"),
  scene("names", "Tab names", "2.0.0"),
  scene("finished"),
];
const states = (id: string) =>
  checklist("2.0.0", id, SAMPLE).groups.map((group) => [
    group.heading,
    ...group.items.map((item) => `${item.state} ${item.label}`),
  ]);

test("Demo - Checklist - the opening list: this release's features first, nothing ticked, the first one next", () => {
  assert.deepEqual(states("names"), [
    ["New in 2.0.0", "now Tab names"],
    ["Everything else", "todo Search and filters", "todo Tags"],
  ]);
  assert.deepEqual(
    { done: checklist("2.0.0", "names", SAMPLE).done, total: checklist("2.0.0", "names", SAMPLE).total },
    { done: 0, total: 3 },
  );
});

test("Demo - Checklist - a feature filmed in two scenes is ticked after the second", () => {
  assert.deepEqual(states("filters")[1], ["Everything else", "now Search and filters", "todo Tags"]);
  assert.deepEqual(states("tags")[1], ["Everything else", "done Search and filters", "now Tags"]);
  assert.equal(checklist("2.0.0", "tags", SAMPLE).done, 2);
});

test("Demo - Checklist - before the outro everything is ticked; without a release mark there is one plain group", () => {
  assert.deepEqual(states("finished"), [
    ["New in 2.0.0", "done Tab names"],
    ["Everything else", "done Search and filters", "done Tags"],
  ]);
  assert.deepEqual(
    checklist("3.0.0", "search", SAMPLE).groups.map((group) => group.heading),
    ["Features"],
  );
});

test("Demo - Checklist - every filmed scene but the outro names its line, short enough for the story pane's column", () => {
  for (const each of SCENES) {
    const listed = !each.stillsOnly && each.id !== "finished";
    assert.equal(each.feature !== undefined, listed, `${each.id}: feature line`);
    assert.ok((each.feature ?? "").length <= 36, `${each.id}: "${each.feature}" is too long for a column`);
  }
  const { groups, total } = checklist(version, "finished");
  assert.equal(total, new Set(SCENES.map((each) => each.feature).filter(Boolean)).size);
  // demo/story.ts: two columns of 12 rows (a heading is one); groups of up to 11 lines get a
  // column each, a longer one runs on from the first column into the second
  const ownColumns = groups.length <= 2 && groups.every((group) => group.items.length <= 11);
  const rows = groups.reduce((sum, group) => sum + 1 + group.items.length, 0);
  assert.ok(ownColumns || rows <= 23, `${rows} rows do not fit the pane's two columns`);
});

test("Demo - Checklist - the list is held 5 s, at the film's start and between scenes alike; the GIF clip moves by that lead", () => {
  assert.equal(CHECKLIST_MS, 5_000);
  assert.deepEqual(shiftedGif([3, 9], 5_250), [8.25, 14.25]);
  assert.deepEqual(shiftedGif([3, 9], undefined), [3, 9], "a take from before the checklist has no lead");
});

// ---------- the release's lines are shared with Settings (src/app/release-highlights.ts) ----------

test("Demo - Checklist - the film's New in <version> lines are the release's highlights, in the same order", () => {
  const fresh = checklist(version, "finished").groups.find((group) => group.heading === `New in ${version}`);
  assert.deepEqual(
    (fresh?.items ?? []).map((item) => item.label),
    releaseHighlights(version),
    "Settings → Changes and the film's opening card must list the same features",
  );
});

test("Demo - Checklist - the film's Everything else lines are the shared everything-else array, in the same order", () => {
  const rest = checklist(version, "finished").groups.find((group) => group.heading === "Everything else");
  assert.deepEqual(
    (rest?.items ?? []).map((item) => item.label),
    everythingElse(),
    "the older features the film lists must be src/app/release-highlights.ts EVERYTHING_ELSE",
  );
});

test("Demo - Checklist - every scene takes its line by key from src/app/release-highlights.ts, never as its own text", () => {
  for (const file of readdirSync("demo/scenes").filter((name) => name.endsWith(".ts") && name !== "index.ts")) {
    const source = readFileSync(join("demo/scenes", file), "utf8");
    // each scene object: from its `id:` to the next one's (or the file's end)
    for (const block of source.split(/(?=^\s+id: ")/m).filter((part) => /^\s+feature: /m.test(part))) {
      const id = block.match(/id: "([^"]+)"/)?.[1];
      assert.match(
        block,
        /^\s+feature: (highlightText|everythingElseText)\(/m,
        `${file} ${id}: feature must be highlightText(version, key) or everythingElseText(key)`,
      );
      // a scene new in the release the film presents names that release's line; an older
      // release's scenes have been folded into the everything-else list
      const newIn = block.match(/^\s+newIn: "([^"]+)"/m)?.[1];
      const helper = newIn === version ? "highlightText" : "everythingElseText";
      assert.ok(block.includes(`feature: ${helper}(`), `${file} ${id}: new in ${newIn ?? "no release"}, so ${helper}`);
    }
  }
});
