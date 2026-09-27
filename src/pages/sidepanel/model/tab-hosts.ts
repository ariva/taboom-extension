// Pure: the unique hostnames / addresses behind a set of tab ids — what protect and
// unprotect act on.
import { hostnameOf, isSupportedUrl } from "../../../app/core.ts";

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

// exact strings: url rules match the address as Chrome reports it
export function urlsOf(allTabs: readonly HostTab[], tabIds: readonly number[]): string[] {
  const urls = tabIds.map((tabId) => allTabs.find((tab) => tab.id === tabId)?.url).filter(isSupportedUrl) as string[]; // isSupportedUrl rejects undefined — TS cannot see that
  return [...new Set(urls)];
}
