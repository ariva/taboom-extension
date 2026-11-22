// The Useful Links card: the browser's own pages worth knowing. Chrome's open through the tabs
// API (a chrome:// address cannot be a plain href); Firefox refuses that for its about: pages
// ("Illegal URL"), so its list is addresses to copy (a Copy button each) — but for the shortcut page, which has an API.
import { closest, getElementById } from "../../lib/dom.ts";
import { capabilities, shortcutSettingsOpener } from "../../lib/platform/capabilities.ts";

// the button answers in place for a moment: this page has no toast
function flashLabel(button: HTMLElement, label: string): void {
  button.textContent = label;
  setTimeout(() => {
    button.textContent = "Copy";
  }, 1500);
}

export function initUsefulLinks(): void {
  const links = getElementById("links");
  links.addEventListener("click", (event) => {
    const link = closest(event.target, "a[data-url]");
    if (!link) {
      return;
    }
    event.preventDefault();
    chrome.tabs.create({ url: link.dataset.url });
  });
  if (capabilities.sidePanel) {
    return; // Chromium: the static markup is its list
  }
  links.hidden = true;
  getElementById("links-note").hidden = true;
  const firefoxLinks = getElementById("links-firefox");
  firefoxLinks.hidden = false;
  firefoxLinks.addEventListener("click", (event) => {
    const button = closest(event.target, "button.copy-address");
    const address = button?.closest("li")?.querySelector("code")?.textContent;
    if (!button || !address) {
      return;
    }
    // straight from the click: the write rides on the user activation, no clipboardWrite permission
    navigator.clipboard.writeText(address).then(
      () => flashLabel(button, "Copied"),
      () => flashLabel(button, "Not copied"), // the address is still there to select by hand
    );
  });
  const openShortcuts = shortcutSettingsOpener();
  if (openShortcuts) {
    const button = getElementById("open-shortcut-settings");
    button.hidden = false;
    button.addEventListener("click", () => void openShortcuts());
  }
}
