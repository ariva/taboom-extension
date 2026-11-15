// The browser's local favicon cache ("favicon" permission, Chromium's _favicon/) — no network
// request to the site. undefined where the browser has no such store (Firefox): the caller
// shows a placeholder, never the site's own icon URL
import { capabilities } from "./capabilities.ts";

export function faviconUrl(pageUrl: string, size: number): string | undefined {
  if (!capabilities.cachedFavicons) {
    return undefined;
  }
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(size));
  return url.toString();
}
