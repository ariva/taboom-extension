// Store installs get `update_url` injected into the manifest; an unpacked
// (local dev) copy never has it. Lets both run side by side distinguishably.
export const IS_DEV = !chrome.runtime.getManifest().update_url;

export const DEV_PREFIX = IS_DEV ? "DEV · " : "";

// display name; manifest.name carries a store-listing suffix ("by ariva-tools")
export function getAppName() {
  return "Taboom - Tabs Manager";
}

// manifest version as shipped, e.g. "0.2.16"
export function getReleaseVersion() {
  return chrome.runtime.getManifest().version;
}

// prefix tab title + page heading so the dev panel/options are unmistakable
export function markDevPage() {
  if (!IS_DEV) {
    return;
  }
  document.title = DEV_PREFIX + document.title;
  const heading = document.querySelector("h1");
  if (heading) {
    heading.textContent = DEV_PREFIX + heading.textContent;
  }
}
