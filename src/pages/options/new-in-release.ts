// The card on top of the Changes pane: what is new in the installed release, a few words per
// feature — the same lines the demo film opens with (src/app/release-highlights.ts). Only the
// latest release gets it; a release with nothing to list (fixes only) shows no card.
import { releaseHighlights } from "../../app/release-highlights.ts";
import { getElementById } from "../../lib/dom.ts";

// `date`: the release's date from its CHANGES.md entry, when that file could be read
export function renderNewInRelease(version: string, date?: string): void {
  const card = getElementById("new-in-release");
  const lines = releaseHighlights(version);
  card.hidden = lines.length === 0;
  if (lines.length === 0) {
    return;
  }
  getElementById("new-in-title").textContent = `New in v${version}`;
  const when = getElementById("new-in-date");
  when.textContent = date ?? "";
  when.hidden = date === undefined;
  getElementById("new-in-list").replaceChildren(
    ...lines.map((text) => {
      const line = document.createElement("li");
      line.textContent = text;
      return line;
    }),
  );
}
