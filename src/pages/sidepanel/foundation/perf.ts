// Performance metrics (PERFORMANCE flag): times a call, buffers the samples and
// flushes them to storage.local.perfMetrics in one write per burst.
import { featureEnabled, recordMetric } from "../../../app/core.ts";
import { localStore } from "../../../app/storage.ts";
import { state } from "./state.ts";

// Samples collect during a render burst, then one storage write on the next
// task — storage.local.perfMetrics is always current (the render-triggering
// storage listener ignores perf keys, so this can't echo into more renders).
const perfBuffer: [key: string, ms: number][] = [];
let perfFlushQueued = false;

// flags are static per load — read per call only because main.ts assigns
// state.rawFeatures after this module is evaluated
export function perfOn(): boolean {
  return featureEnabled(state.rawFeatures, "PERFORMANCE");
}

export function perfMeasure<T>(key: string, fn: () => T): T {
  if (!perfOn()) {
    return fn();
  }
  const start = performance.now();
  const result = fn();
  perfBuffer.push([key, performance.now() - start]);
  if (!perfFlushQueued) {
    perfFlushQueued = true;
    setTimeout(flushPerfMetrics, 0);
  }
  return result;
}

async function flushPerfMetrics(): Promise<void> {
  perfFlushQueued = false;
  if (perfBuffer.length === 0) {
    return;
  }
  const samples = perfBuffer.splice(0);
  const { perfMetrics = {} } = await localStore.get("perfMetrics");
  await localStore.set({
    perfMetrics: samples.reduce((m, [key, ms]) => recordMetric(m, key, ms), perfMetrics),
  });
}
