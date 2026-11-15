// The dev marker comes from the BUILD: `just dev` (Vite mode development → dist/dev-chrome, dist/dev-firefox) is the
// dev copy, every other build is the shipped one. Not from the manifest's update_url — the
// Chrome store injects it, Firefox's AMO never does, so that test would mark every Firefox
// install as DEV (T-0152). Lets the dev copy and the store copy run side by side distinguishably.
export const IS_DEV = import.meta.env.MODE === "development";

export const DEV_PREFIX = IS_DEV ? "DEV · " : "";

// display name; manifest.name carries a store-listing suffix ("by ariva-tools")
export function getAppName(): string {
  return "Taboom - Tabs Manager";
}

// manifest version as shipped, e.g. "0.2.16"
export function getReleaseVersion(): string {
  return chrome.runtime.getManifest().version;
}

// prefix tab title + page heading so the dev panel/options are unmistakable
export function markDevPage(): void {
  if (!IS_DEV) {
    return;
  }
  document.title = DEV_PREFIX + document.title;
  const heading = document.querySelector("h1");
  if (heading) {
    heading.textContent = DEV_PREFIX + heading.textContent;
  }
}
