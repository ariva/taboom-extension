// `node tests/perf/compare.ts [older.json] [newer.json]` — default: the two newest runs in
// .private/perf/ with the same tab count as the newest. Prints a Markdown table with deltas;
// a median more than 25 % above the older run is marked SLOWER. Never a gate.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareRuns, formatCompare, type PerfRun } from "./stats.ts";

const OUT_DIR = resolve(import.meta.dirname, "../../.private/perf/data");
const read = (file: string): PerfRun => JSON.parse(readFileSync(file, "utf8")) as PerfRun;

const [olderArg, newerArg] = process.argv.slice(2);
let older: PerfRun;
let newer: PerfRun;
if (olderArg && newerArg) {
  older = read(resolve(olderArg));
  newer = read(resolve(newerArg));
} else {
  const files = readdirSync(OUT_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(OUT_DIR, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const runs = files.map(read);
  const latest = runs[0];
  if (!latest) {
    console.error("no runs in .private/perf/data — run `just test-perf` first");
    process.exit(1);
  }
  const previous = runs.slice(1).find((run) => run.tabs === latest.tabs) ?? runs[1];
  if (!previous) {
    console.error("only one run so far — nothing to compare against yet");
    process.exit(1);
  }
  older = previous;
  newer = latest;
}
console.log(formatCompare(older, newer, compareRuns(older, newer)));
