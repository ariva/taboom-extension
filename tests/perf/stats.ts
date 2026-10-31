// Pure arithmetic of the performance tier: summaries of a sample list, the comparison of two runs,
// the one-line history entry. No I/O, no browser — tests/perf/stats.test.ts covers it.

export interface Summary {
  unit: string;
  median: number;
  p95: number;
  min: number;
  samples: number[];
}

export interface PerfRun {
  version: string;
  commit: string;
  date: string; // ISO
  tabs: number;
  repeat: number;
  machine: { platform: string; cpus: number; node: string };
  scenarios: Record<string, Summary>;
}

export function percentile(samples: number[], fraction: number): number {
  if (samples.length === 0) {
    return Number.NaN;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? Number.NaN;
}

export function median(samples: number[]): number {
  if (samples.length === 0) {
    return Number.NaN;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const low = sorted[middle - 1] ?? Number.NaN;
  const high = sorted[middle] ?? Number.NaN;
  return sorted.length % 2 === 0 ? (low + high) / 2 : high;
}

export function summarize(samples: number[], unit = "ms"): Summary {
  const rounded = samples.map((value) => Math.round(value * 10) / 10);
  return { unit, median: median(rounded), p95: percentile(rounded, 0.95), min: Math.min(...rounded), samples: rounded };
}

export interface CompareRow {
  scenario: string;
  before: number | null; // median, null when the scenario is missing on that side
  after: number | null;
  deltaPct: number | null; // (after - before) / before, null when either side is missing or before is 0
  slower: boolean; // beyond the threshold
}

// medians side by side; a scenario is "slower" when its median grew by more than `thresholdPct`
export function compareRuns(older: PerfRun, newer: PerfRun, thresholdPct = 25): CompareRow[] {
  const names = [...new Set([...Object.keys(older.scenarios), ...Object.keys(newer.scenarios)])];
  return names.map((scenario) => {
    const before = older.scenarios[scenario]?.median ?? null;
    const after = newer.scenarios[scenario]?.median ?? null;
    const deltaPct = before !== null && after !== null && before > 0 ? ((after - before) / before) * 100 : null;
    return { scenario, before, after, deltaPct, slower: deltaPct !== null && deltaPct > thresholdPct };
  });
}

// runs are stored with a UTC ISO date; everything a human reads shows it in the machine's own zone
export function localStamp(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatCompare(older: PerfRun, newer: PerfRun, rows: CompareRow[]): string {
  const head = `${older.version} ${older.commit} (${older.tabs} tabs, ${localStamp(older.date)}) → ${newer.version} ${newer.commit} (${newer.tabs} tabs, ${localStamp(newer.date)})`;
  const warn = older.tabs !== newer.tabs ? "\nWARNING: different tab counts — the deltas are not comparable\n" : "\n";
  const cell = (value: number | null) => (value === null ? "—" : String(value));
  const delta = (row: CompareRow) =>
    row.deltaPct === null
      ? "—"
      : `${row.deltaPct > 0 ? "+" : ""}${row.deltaPct.toFixed(0)}%${row.slower ? " SLOWER" : ""}`;
  const lines = rows.map((row) => `| ${row.scenario} | ${cell(row.before)} | ${cell(row.after)} | ${delta(row)} |`);
  const overall = `\noverall: ${judgement(overallDeltaPct(rows))} (median of the deltas; smaller is better)`;
  return [head, warn, "| scenario | before | after | delta |", "|---|---|---|---|", ...lines, overall].join("\n");
}

// one number for the whole run: the median of the per-scenario deltas (both sides measured) — a
// median, so one scenario hit by a background process does not drag the verdict (the movers column
// still names it); the words come from the same margins everywhere — within 5 % is noise, beyond
// 25 % is SLOWER
export function overallDeltaPct(rows: CompareRow[]): number | null {
  const deltas = rows.map((row) => row.deltaPct).filter((delta): delta is number => delta !== null);
  return deltas.length === 0 ? null : median(deltas);
}

export function judgement(deltaPct: number | null, thresholdPct = 25): string {
  if (deltaPct === null) {
    return "—";
  }
  if (Math.abs(deltaPct) < 5) {
    return "≈ same";
  }
  const percent = `${Math.abs(deltaPct).toFixed(0)}%`;
  if (deltaPct < 0) {
    return `${percent} faster`;
  }
  return `${percent} slower${deltaPct > thresholdPct ? " (SLOWER)" : ""}`;
}

// the verdict against the previous run of the same tab count: every scenario that moved by 10 %
// or more, the ones beyond the SLOWER margin marked; "≈ same" when none did
export function historyVerdict(previous: PerfRun | undefined, run: PerfRun, thresholdPct = 25): string {
  if (!previous) {
    return "— (first run at this tab count)";
  }
  const moved = compareRuns(previous, run, thresholdPct)
    .filter((row) => row.deltaPct !== null && Math.abs(row.deltaPct) >= 10)
    .map(
      (row) =>
        `${row.scenario} ${row.deltaPct !== null && row.deltaPct > 0 ? "+" : ""}${row.deltaPct?.toFixed(0)}%${row.slower ? " SLOWER" : ""}`,
    );
  return moved.length === 0 ? `≈ same as ${previous.commit}` : `vs ${previous.commit}: ${moved.join(", ")}`;
}

// the HISTORY.md row: one line per run, medians only, in the scenario order of the run, then the verdict
export function historyLine(run: PerfRun, order: string[], previous?: PerfRun): string {
  const cells = order.map((name) => {
    const summary = run.scenarios[name];
    return summary ? String(summary.median) : "—";
  });
  const overall = previous ? judgement(overallDeltaPct(compareRuns(previous, run))) : "—";
  return `| ${localStamp(run.date)} | ${run.version} | ${run.commit} | ${run.tabs} | ${run.repeat} | ${cells.join(" | ")} | ${overall} | ${historyVerdict(previous, run)} |`;
}

export function historyHeader(order: string[]): string {
  return [
    `| date | version | commit | tabs | reps | ${order.join(" | ")} | overall | vs previous (same tabs) |`,
    `|---|---|---|---|---|${order.map(() => "---").join("|")}|---|---|`,
  ].join("\n");
}

// versions compare by their numeric parts: 1.0.10 after 1.0.9
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index++) {
    const delta = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

// the whole HISTORY.md from every stored run: rebuilt on each run, so a header change or a late
// run of an older release lands in the right place — sorted by version, then date, so the verdict
// of each line is against the latest run BEFORE it in that order with the same tab count (an old
// release measured today is still judged against the release before it, not against HEAD)
export function historyTable(runs: PerfRun[], order: string[]): string {
  const sorted = [...runs].sort((a, b) => compareVersions(a.version, b.version) || a.date.localeCompare(b.date));
  const lines = sorted.map((run, index) => {
    const previous = sorted
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.tabs === run.tabs);
    return historyLine(run, order, previous);
  });
  return [historyHeader(order), ...lines].join("\n");
}
