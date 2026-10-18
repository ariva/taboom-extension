// The demo recorder's scene registry (demo/scenes/index.ts): the "new in this release" scenes
// must cover every New Features bullet of the current CHANGES.md entry, ids are unique, the
// GIF clips fit the budget. Runs once (flag-independent).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { GIF_MAX_SECONDS, orderedForRelease, SCENES } from "../../demo/scenes/index.ts";

const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

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
