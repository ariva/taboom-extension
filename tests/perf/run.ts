// The performance tier: `node tests/perf/run.ts [--tabs 2000] [--repeat 15] [--label full] [--browser chrome|firefox]`
// against dist/chrome (dist/firefox for Firefox; build first — the just recipes do). `--extension <dir> --commit <hash>`
// measures another build (tests/perf/at-ref.sh builds a commit in a worktree) with the same scenarios. One JSON per
// run under .private/perf/ and .private/perf/HISTORY.md (one line per run) + COMPARISONS.md (each version's latest
// run against the version before, per browser) rebuilt from every run.
import { execSync } from "node:child_process";
import { cpus } from "node:os";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SCENARIOS } from "./scenarios.ts";
import { historyTable, localStamp, type PerfBrowser, type PerfRun, releaseComparisons } from "./stats.ts";
import { DEFAULT_EXTENSION_DIR, DEFAULT_FIREFOX_EXTENSION_DIR, launchWorld } from "./world.ts";

const { values } = parseArgs({
  options: {
    tabs: { type: "string", default: process.env.PERF_TABS ?? "2000" },
    repeat: { type: "string", default: process.env.PERF_REPEAT ?? "15" },
    label: { type: "string", default: "full" },
    extension: { type: "string" },
    commit: { type: "string" }, // the label of a build that is not the working tree's
    browser: { type: "string", default: "chrome" },
  },
});
if (values.browser !== "chrome" && values.browser !== "firefox") {
  throw new Error(`--browser ${values.browser}: expected chrome or firefox`);
}
const browser: PerfBrowser = values.browser;
const wantedTabs = Number(values.tabs);
const repeat = Number(values.repeat);
const PERF_DIR = resolve(import.meta.dirname, "../../.private/perf"); // HISTORY.md, COMPARISONS.md
const OUT_DIR = join(PERF_DIR, "data"); // one JSON per run
const extensionDir = resolve(
  values.extension ?? (browser === "firefox" ? DEFAULT_FIREFOX_EXTENSION_DIR : DEFAULT_EXTENSION_DIR),
);
// the version of the BUILD measured, not of the checkout running the scenarios
const { version } = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8")) as { version: string };
const ownBuild = values.commit === undefined;
const commit = values.commit ?? execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
const dirty = ownBuild && execSync("git status --porcelain -- src", { encoding: "utf8" }).trim() !== "";
const log = (line: string) => console.log(`[perf] ${line}`);

log(
  `building ${wantedTabs} tabs (${values.label}, ${repeat} repetitions, ${browser}) for ${version} ${commit}${dirty ? "+dirty" : ""}`,
);
const started = Date.now();
const world = await launchWorld(wantedTabs, log, extensionDir, browser);
try {
  log(`world ready: ${world.tabCount} tabs in ${Math.round((Date.now() - started) / 1000)} s`);
  const run: PerfRun = {
    version,
    commit: dirty ? `${commit}+dirty` : commit,
    date: new Date().toISOString(),
    tabs: world.tabCount,
    repeat,
    browser,
    machine: { platform: process.platform, cpus: cpus().length, node: process.version },
    scenarios: {},
  };
  for (const scenario of SCENARIOS) {
    const summary = await scenario.run(world, repeat, log);
    run.scenarios[scenario.name] = summary;
    log(`${scenario.name.padEnd(10)} median ${summary.median} ${summary.unit}  p95 ${summary.p95}  — ${scenario.what}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = localStamp(run.date).replace(/[: ]/g, "-"); // file names read like the table: local time
  // a Firefox run is marked in its file name too, so the data folder reads at a glance
  const file = join(OUT_DIR, `${version}-${stamp}-${values.label}${browser === "firefox" ? "-firefox" : ""}.json`);
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
  // HISTORY.md is rebuilt from every stored run: sorted by version then date, each line judged against the
  // latest earlier run with the same tab count (so a late run of an older commit sorts into place)
  const runs = readdirSync(OUT_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(OUT_DIR, name), "utf8")) as PerfRun);
  const order = SCENARIOS.map((scenario) => scenario.name);
  writeFileSync(
    join(PERF_DIR, "HISTORY.md"),
    `# Performance history\n\nOne line per run (\`just test-perf\`, \`perf-quick\`, \`perf-at\`, \`perf-refs\`): dates in local time, medians per scenario in milliseconds (scroll = p95 frame interval in ms) — SMALLER IS BETTER in every column — then two verdicts against the latest earlier run of the same tab count: overall = the median of the per-scenario deltas in words (within 5 % is noise, beyond 25 % is SLOWER), and the scenarios that moved by 10 % or more. Same machine only. Details: \`just perf-compare\`.\n\n${historyTable(runs, order)}\n`,
  );
  writeFileSync(
    join(PERF_DIR, "COMPARISONS.md"),
    `# Release comparisons\n\nRebuilt from every stored run, like HISTORY.md: one section per version, its latest run against the latest run of the version before with the same tab count (the output of \`just perf-compare\` for that pair). Newest version first. SMALLER IS BETTER; a median more than 25 % above the older run is marked SLOWER.\n\n${releaseComparisons(runs)}\n`,
  );
  log(`written ${file}`);
} finally {
  await world.close();
}
