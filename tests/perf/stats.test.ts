import assert from "node:assert/strict";
import { test } from "vitest";
import {
  compareRuns,
  formatCompare,
  historyHeader,
  historyLine,
  historyTable,
  judgement,
  localStamp,
  median,
  overallDeltaPct,
  percentile,
  releaseComparisons,
  summarize,
} from "./stats.ts";
import type { PerfRun } from "./stats.ts";

const run = (scenarios: Record<string, number>, extra: Partial<PerfRun> = {}): PerfRun => ({
  version: "1.0.8",
  commit: "abc1234",
  date: "2026-10-29T20:00:00.000Z",
  tabs: 2000,
  repeat: 5,
  machine: { platform: "linux", cpus: 8, node: "v24" },
  scenarios: Object.fromEntries(
    Object.entries(scenarios).map(([name, value]) => [
      name,
      { unit: "ms", median: value, p95: value, min: value, samples: [value] },
    ]),
  ),
  ...extra,
});

test("Perf stats - median and percentile over an unsorted sample list", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
  assert.equal(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.95), 100);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(summarize([3.26159, 1, 2]).median, 2);
  assert.deepEqual(summarize([3.26159, 1, 2]).samples, [3.3, 1, 2], "samples kept to one decimal");
});

test("Perf stats - compareRuns flags a median grown beyond the threshold and tolerates missing scenarios", () => {
  const rows = compareRuns(run({ boot: 100, search: 40, gone: 7 }), run({ boot: 130, search: 44, added: 9 }), 25);
  const byName = Object.fromEntries(rows.map((row) => [row.scenario, row]));
  assert.equal(byName.boot?.slower, true, "+30% is slower");
  assert.equal(Math.round(byName.boot?.deltaPct ?? 0), 30);
  assert.equal(byName.search?.slower, false, "+10% is within the margin");
  assert.equal(byName.gone?.after, null);
  assert.equal(byName.added?.before, null);
  assert.equal(byName.gone?.deltaPct, null);
});

test("Perf stats - the compare table and the history line read as Markdown", () => {
  const older = run({ boot: 100 });
  const newer = run({ boot: 130 }, { commit: "def5678", tabs: 1000 });
  const table = formatCompare(older, newer, compareRuns(older, newer));
  assert.match(table, /WARNING: different tab counts/);
  assert.match(table, /\| boot \| 100 \| 130 \| \+30% SLOWER \|/);
  assert.equal(
    historyHeader(["boot", "search"]),
    "| date | version | commit | tabs | reps | boot | search | overall | vs previous (same tabs) |\n|---|---|---|---|---|---|---|---|---|",
  );
  assert.equal(
    historyLine(older, ["boot", "search"]),
    `| ${localStamp(older.date)} | 1.0.8 | abc1234 | 2000 | 5 | 100 | — | — | — (first run at this tab count) |`,
  );
});

test("Perf stats - dates are shown in the machine's own time zone, not UTC", () => {
  const iso = "2026-10-29T20:00:00.000Z";
  const local = new Date(iso);
  assert.match(localStamp(iso), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(localStamp(iso).slice(11, 13), String(local.getHours()).padStart(2, "0"));
  assert.equal(
    localStamp(iso).slice(0, 10),
    `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`,
  );
});

test("Perf stats - the history table says better or worse against the latest earlier run of the same tab count", () => {
  const first = run({ boot: 100, search: 40 }, { date: "2026-10-29T10:00:00.000Z", commit: "aaa1111" });
  const other = run({ boot: 50, search: 20 }, { date: "2026-10-29T11:00:00.000Z", commit: "bbb2222", tabs: 500 });
  const second = run({ boot: 130, search: 41 }, { date: "2026-10-29T12:00:00.000Z", commit: "ccc3333" });
  const third = run({ boot: 131, search: 42 }, { date: "2026-10-29T13:00:00.000Z", commit: "ddd4444" });
  // an older release measured after everything else sorts first and is judged against nothing
  const late = run(
    { boot: 200, search: 80 },
    { date: "2026-10-29T14:00:00.000Z", commit: "eee5555", version: "1.0.7" },
  );
  const lines = historyTable([third, first, other, late, second], ["boot", "search"]).split("\n").slice(2);
  assert.match(lines.shift() ?? "", /1\.0\.7 \| eee5555 \| 2000 \| .* \| — \| — \(first run at this tab count\) \|$/);
  assert.match(
    lines[0] ?? "",
    /aaa1111 \| 2000 \| .* \| vs eee5555: boot -50%, search -50% \|$/,
    "the first 1.0.8 run is judged against the 1.0.7 one",
  );
  assert.match(
    lines[1] ?? "",
    /bbb2222 \| 500 \| .* \| — \| — \(first run at this tab count\) \|$/,
    "another count: its own baselines",
  );
  assert.match(
    lines[2] ?? "",
    /ccc3333 \| 2000 \| .* \| 16% slower \| vs aaa1111: boot \+30% SLOWER \|$/,
    "search +2% is not worth a word",
  );
  assert.match(lines[3] ?? "", /ddd4444 \| 2000 \| .* \| ≈ same \| ≈ same as ccc3333 \|$/);
});

test("Perf stats - the overall judgement is the median delta in words: within 5 % is the same, beyond 25 % shouts", () => {
  assert.equal(overallDeltaPct([]), null);
  assert.equal(judgement(null), "—");
  assert.equal(judgement(4.9), "≈ same");
  assert.equal(judgement(-12), "12% faster");
  assert.equal(judgement(12), "12% slower");
  assert.equal(judgement(40), "40% slower (SLOWER)");
  const rows = compareRuns(run({ boot: 100, search: 50, sort: 10 }), run({ boot: 130, search: 50, sort: 40 }));
  assert.equal(overallDeltaPct(rows), 30, "the median: one +300% outlier does not set the verdict");
  assert.match(
    formatCompare(run({ boot: 100 }), run({ boot: 80 }), compareRuns(run({ boot: 100 }), run({ boot: 80 }))),
    /overall: 20% faster/,
  );
});

test("Perf stats - release comparisons pair the latest run of each version with the version before, newest first", () => {
  const old = run({ boot: 100, search: 40 }, { version: "1.0.7", commit: "aaa1111", date: "2026-10-29T10:00:00.000Z" });
  const early = run({ boot: 90, search: 40 }, { commit: "bbb2222", date: "2026-10-29T11:00:00.000Z" });
  const quick = run({ boot: 30, search: 10 }, { commit: "ccc3333", date: "2026-10-29T12:00:00.000Z", tabs: 500 });
  const latest = run({ boot: 50, search: 40 }, { commit: "ddd4444", date: "2026-10-29T13:00:00.000Z" });
  const next = run(
    { boot: 55, search: 45 },
    { version: "1.0.9", commit: "eee5555", date: "2026-10-29T14:00:00.000Z", tabs: 1000 },
  );
  const text = releaseComparisons([early, next, old, latest, quick]);
  const headings = text.split("\n").filter((line) => line.startsWith("## "));
  assert.deepEqual(
    headings,
    ["## 1.0.8 → 1.0.9", "## 1.0.7 → 1.0.8"],
    "newest version first, the oldest has no predecessor",
  );
  assert.match(text, /1\.0\.7 aaa1111 .* → 1\.0\.8 ddd4444 /, "the latest 2000-tab run of 1.0.8, not the first one");
  assert.match(text, /\| boot \| 100 \| 50 \| -50% \|/);
  assert.match(
    text,
    /## 1\.0\.8 → 1\.0\.9\n\nno 1\.0\.8 run with 1000 tabs to compare against/,
    "pairs only with the same tab count",
  );
  assert.doesNotMatch(text, /ccc3333/, "the 500-tab 1.0.8 run does not stand in for the full one");
  assert.equal(releaseComparisons([old]), "", "one version: nothing to compare");
});
