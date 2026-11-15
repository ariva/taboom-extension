// Pins WHAT SHIPS: the release zip's file list and its manifest (minus version).
// The TypeScript migration rebuilds the tooling around the extension — this test is
// the proof that each step still packs the same extension. An intended change is
// recorded on purpose:  UPDATE_SNAPSHOT=1 npx vitest run tests/structure/release-snapshot.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { fileURLToPath } from "node:url";

const SNAPSHOT = new URL("../fixtures/release-snapshot.json", import.meta.url);
const SNAPSHOT_FIREFOX = new URL("../fixtures/release-snapshot-firefox.json", import.meta.url);
const PACK = fileURLToPath(new URL("../../scripts/pack.sh", import.meta.url));

// target: the browser flavour pack.sh builds (dist/chrome, or dist/firefox with TARGET=firefox)
function packedRelease(target: "chrome" | "firefox" = "chrome") {
  const dir = mkdtempSync(join(tmpdir(), "taboom-pack-"));
  try {
    const zip = join(dir, "release.zip");
    execFileSync(PACK, [zip], { env: { ...process.env, TARGET: target } });
    const files = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
      .split("\n")
      .filter((name) => name && !name.endsWith("/")) // directory entries are noise
      .sort();
    // version moves every release — everything else in the manifest is contract
    const { version, ...manifest }: Record<string, unknown> = JSON.parse(
      execFileSync("unzip", ["-p", zip, "manifest.json"], { encoding: "utf8" }),
    );
    // every text file's content, by name — the dev-leak audit below reports WHERE a leak is
    const contents = new Map<string, string>();
    for (const name of files.filter((file) => /\.(js|html|css|json)$/.test(file))) {
      contents.set(name, execFileSync("unzip", ["-p", zip, name], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    }
    return { files, manifest, contents };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function matchesSnapshot(target: "chrome" | "firefox", snapshot: URL): ReturnType<typeof packedRelease> {
  const actual = packedRelease(target);
  if (process.env.UPDATE_SNAPSHOT === "1") {
    // files + manifest only — `contents` is the whole bundle, used by the audit test, never stored
    writeFileSync(snapshot, `${JSON.stringify({ files: actual.files, manifest: actual.manifest }, null, 2)}\n`);
  }
  const expected: { files: string[]; manifest: Record<string, unknown> } = JSON.parse(readFileSync(snapshot, "utf8"));
  assert.deepEqual(actual.files, expected.files, `shipped file list changed (${target})`);
  assert.deepEqual(actual.manifest, expected.manifest, `shipped manifest changed (${target})`);
  return actual;
}

test("Release Package - Zip file list and manifest match the recorded snapshot", () => {
  const { contents } = matchesSnapshot("chrome", SNAPSHOT);
  // the Firefox branch of the platform seam folds away in the Chrome build (__FIREFOX__ false): the
  // detection getter still names the API, the calls are gone
  const panel = contents.get("chunks/panel.js") ?? "";
  assert.ok(!/sidebar\.(open|toggle)\(/.test(panel), "no sidebarAction calls in the Chrome bundle");
});

// the Firefox zip: the same files, the Firefox manifest (event page, sidebar_action, gecko settings);
// the Chrome branch of the platform seam folds away (__CHROME__ false)
test("Release Package - The Firefox zip matches its recorded snapshot and ships the same files", () => {
  const { contents } = matchesSnapshot("firefox", SNAPSHOT_FIREFOX);
  const chrome: { files: string[] } = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const firefox: { files: string[] } = JSON.parse(readFileSync(SNAPSHOT_FIREFOX, "utf8"));
  assert.deepEqual(firefox.files, chrome.files, "one file list, two manifests");
  const panel = contents.get("chunks/panel.js") ?? "";
  assert.ok(!/sidePanel\.(open|setPanelBehavior)\(/.test(panel), "no sidePanel calls in the Firefox bundle");
});

// AMO's validator on the Firefox build (the pack above left it in dist/firefox): no errors, no
// warnings. Anything (an innerHTML with a variable, a manifest key Firefox for Android cannot take, a
// Chrome-only API name) is a reviewer question to answer before upload, so it fails here first.
test("Release Package - web-ext lint on the Firefox build: clean", () => {
  const report = JSON.parse(
    execFileSync(
      "npx",
      ["--no-install", "web-ext", "lint", "--source-dir", "dist/firefox", "--no-config-discovery", "--output", "json"],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  ) as { errors: { code: string }[]; warnings: { code: string; message: string; file?: string }[] };
  assert.deepEqual(report.errors, []);
  assert.deepEqual(
    report.warnings.map((warning) => `${warning.code} ${warning.file ?? ""}: ${warning.message}`),
    [],
  );
});

test("Release Package - Ships no dev-only or tooling files", () => {
  const { files } = packedRelease();
  const stray = files.filter((name) =>
    /^(icons\/dev\/|tests\/|scripts\/|node_modules\/|\.|package(-lock)?\.json|jsconfig\.json|justfile)/.test(name),
  );
  assert.deepEqual(stray, [], "dev/tooling files must never reach the store zip");
});

// The repo contains dev-only networking code (tooling/dev-reload-plugin.ts). The store
// build must stay what the listing promises: fully local, zero network requests.
// Each entry: a string that must never appear in the release zip, and what finding it means.
const FORBIDDEN_IN_RELEASE: [needle: string, meaning: string][] = [
  ["dev-reload", "the dev-reload client or its <script> tag was emitted into a production build"],
  ["localhost", "code that talks to a local server (the dev-reload long-poll, or a hard-coded URL)"],
  ["127.0.0.1", "code that talks to a local server (the dev-reload long-poll, or a hard-coded URL)"],
  ["ws://", "a WebSocket connection — the extension makes no network connections at all"],
  ["import.meta.hot", "Vite hot-module code — that only exists when a dev server is involved"],
  // the dev marker is a build-time constant (src/app/env.ts): a production build folds it away
  ["DEV · ", "the dev-build marker — IS_DEV must come from the build mode, not a runtime check"],
];

// "sidepanel/index.js:120: const response = await fetch("http://localhost:5183/poll…"
function occurrences(contents: ReadonlyMap<string, string>, needle: string): string[] {
  const found: string[] = [];
  for (const [file, text] of contents) {
    text.split("\n").forEach((line, index) => {
      if (line.includes(needle)) {
        found.push(`  ${file}:${index + 1}: ${line.trim().slice(0, 140)}`);
      }
    });
  }
  return found;
}

test("Release Package - Production bundle carries no dev-loop or network code", () => {
  const { files, contents } = packedRelease();
  const maps = files.filter((name) => name.endsWith(".map"));
  assert.deepEqual(
    maps,
    [],
    `The release zip contains source maps: ${maps.join(", ")}.\n` +
      "Source maps are for the dev builds only — check `build.sourcemap` in vite.config.ts (it must be off unless the mode is development).",
  );
  for (const [needle, meaning] of FORBIDDEN_IN_RELEASE) {
    const found = occurrences(contents, needle);
    // assert.ok, not equal: the message is the whole point — no "1 !== 0" diff after it
    assert.ok(
      found.length === 0,
      `The release zip (dist/chrome) contains "${needle}" — ${meaning}.\n` +
        `Found in:\n${found.slice(0, 8).join("\n")}${found.length > 8 ? `\n  … and ${found.length - 8} more` : ""}\n` +
        "Why it matters: the store listing promises a fully local extension with zero network requests, and this test is what keeps that true.\n" +
        "How to fix: find where that code comes from in src/ (or which tooling/ plugin emitted it) and make sure it only runs or is emitted in development mode " +
        "(see how tooling/dev-reload-plugin.ts checks `config.mode` and `build.watch`). If the string is legitimate text — a comment, a label — reword it, " +
        `or, if it really must ship, remove "${needle}" from FORBIDDEN_IN_RELEASE in this file with a comment saying why.`,
    );
  }
});
