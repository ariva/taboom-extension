// Which recorded pane a page's frames belong to. The panel is told apart by identity (it is one
// page); the story pane and the Settings page by their address.
import type { Stream } from "./page-api.ts";

// A page is its document, whatever fragment the address carries: the Settings page keeps its
// selected tab there (#tags), and matched by the whole address it stopped being "the Settings
// page" at the first tab switch — its frames were dropped and the film showed a dark tile.
// Also how the recorders ask "is this page an active tab": the browser's tab list names the
// fragment, a Firefox page object does not hear of it (BiDi reports navigations only).
export function documentOf(url: string): string {
  const hash = url.indexOf("#");
  return hash < 0 ? url : url.slice(0, hash);
}

export function streamOfUrl(url: string, panes: { story: string; settings: string }): Stream | undefined {
  const document = documentOf(url);
  if (document === documentOf(panes.story)) {
    return "story";
  }
  return document === documentOf(panes.settings) ? "settings" : undefined;
}

// The panes a filmed scene's take has no frames of. encode.sh composes a missing pane as a dark
// tile, silently — the recorder names it instead, so it is seen before the film is published.
const PANES: Stream[] = ["panel", "story", "settings"];
export function missingStreams(streams: Stream[]): Stream[] {
  return PANES.filter((pane) => !streams.includes(pane));
}
