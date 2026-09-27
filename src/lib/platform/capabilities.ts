// What this browser offers, feature-detected — never a browser-name check.
// A missing capability hides the feature, like a disabled feature flag does.
// Getters, not constants: detection runs at the point of use, after test setup
// has installed its chrome global.
export const capabilities = {
  get tabGroups(): boolean {
    return Boolean(chrome.tabGroups);
  },
};
