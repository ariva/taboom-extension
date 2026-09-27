// Chrome's local favicon cache ("favicon" permission) — no network request to the site
export function faviconUrl(pageUrl: string, size: number): string {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", String(size));
  return url.toString();
}
