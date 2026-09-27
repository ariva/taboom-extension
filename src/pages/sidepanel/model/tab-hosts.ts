// Pure: the unique hostnames behind a set of tab ids — what protect / unprotect act on.
import { hostnameOf } from "../../../app/core.ts";

interface HostTab {
  id: number;
  url?: string;
}

export function hostsOf(allTabs: readonly HostTab[], tabIds: readonly number[]): string[] {
  const hosts = (tabIds.map((tabId) => allTabs.find((tab) => tab.id === tabId)).filter(Boolean) as HostTab[]) // filter(Boolean) drops the misses — TS cannot see that
    .map((tab) => hostnameOf(tab.url))
    .filter(Boolean);
  return [...new Set(hosts)];
}
