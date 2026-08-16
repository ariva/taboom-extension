// Validates the real CHANGES.md so the options "What's new" section never
// renders broken notes. Runs with the suite, and `just build` depends on check.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { releaseNotes } from "../options/model.js";

const md = readFileSync(new URL("../CHANGES.md", import.meta.url), "utf8");

test("Release Notes - Starts with the # CHANGES header", () => {
  assert.match(md, /^# CHANGES\n/);
});

test("Release Notes - Every section heading is 'v<semver> — <date>' with non-empty body", () => {
  const sections = md.split(/^## /m).slice(1);
  assert.ok(sections.length > 0, "at least one release section");
  for (const section of sections) {
    const [heading, ...body] = section.split("\n");
    assert.match(heading, /^v\d+\.\d+\.\d+ — \d{4}-\d{2}-\d{2}$/, `bad heading: "${heading}"`);
    assert.ok(body.join("\n").trim().length > 0, `empty body under "${heading}"`);
  }
});

test("Release Notes - Versions are newest-first", () => {
  const versions = [...md.matchAll(/^## v(\d+)\.(\d+)\.(\d+)/gm)].map((m) =>
    m.slice(1).map(Number),
  );
  for (let i = 1; i < versions.length; i++) {
    const [a, b] = [versions[i - 1], versions[i]];
    const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    assert.ok(newer > 0, `v${a.join(".")} must be newer than v${b.join(".")}`);
  }
});

test("Release Notes - releaseNotes extractor finds usable notes for the shipped version", () => {
  const { version } = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const notes = releaseNotes(md, version);
  assert.ok(notes, "extractor returned notes");
  assert.match(notes.title, /^v\d+\.\d+\.\d+ — /);
  assert.ok(notes.body.length > 0);
});
