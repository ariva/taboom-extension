// Performance panel: snapshots the recorded render metrics on Show and resets them.
import { localStore } from "../../app/storage.ts";
import { getElementById } from "../../lib/dom.ts";
import { snapshotBlocks } from "./model.ts";
import { flashSaved } from "./page-state.ts";

const PERF_SNAPSHOTS_MAX = 20;

export function initPerfPanel(): void {
  // each Show click snapshots the current metrics, so the list shows evolution over time
  getElementById("perf-show").addEventListener("click", async () => {
    const { perfMetrics = {}, perfSnapshots = [] } = await localStore.get(["perfMetrics", "perfSnapshots"]);
    let snapshots = perfSnapshots;
    if (Object.keys(perfMetrics).length > 0) {
      snapshots = [...perfSnapshots, { at: Date.now(), metrics: perfMetrics }].slice(-PERF_SNAPSHOTS_MAX);
      await localStore.set({ perfSnapshots: snapshots });
    }
    getElementById("perf-out").textContent = snapshotBlocks(snapshots).join("\n\n") || "No metrics recorded yet.";
  });

  // running counters restart; stored snapshot history stays for comparison
  getElementById("perf-reset-snapshot").addEventListener("click", async () => {
    await localStore.remove("perfMetrics");
    flashSaved();
  });

  getElementById("perf-reset").addEventListener("click", async () => {
    await localStore.remove(["perfMetrics", "perfSnapshots"]);
    getElementById("perf-out").textContent = "";
    flashSaved();
  });
}
