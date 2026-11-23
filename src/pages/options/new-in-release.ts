// The card on top of the Changes pane: the new features of the releases
// VISIBLE_HIGHLIGHTS_RELEASES names, a few words per feature — the same lines the demo film
// ticks off (src/app/release-highlights.ts). Nothing to list shows no card.
import { GROUP_HIGHLIGHTS, visibleHighlights } from "../../app/release-highlights.ts";
import { getElementById } from "../../lib/dom.ts";

function element(tag: string, className: string, text = ""): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function block(lines: string[], heading?: HTMLElement): HTMLElement {
  const list = element("ul", "");
  list.append(...lines.map((text) => element("li", "", text)));
  const box = element("div", "new-in-block");
  box.append(...(heading ? [heading] : []), list);
  return box;
}

// `dateOf`: a release's date from its CHANGES.md entry, once that file has been read.
// The card is headed "Highlights" whenever it shows. Grouped (GROUP_HIGHLIGHTS): every release's
// lines in one list under it. Ungrouped: a block per release under "New in v…" and its date — a
// release shown alone gets no such heading, there is nothing to tell it from.
export function renderNewInRelease(
  dateOf?: (version: string) => string | undefined,
  releases = visibleHighlights(),
  grouped = GROUP_HIGHLIGHTS,
): void {
  getElementById("new-in-release").hidden = releases.length === 0;
  const blocks = grouped
    ? [block(releases.flatMap((release) => release.lines))]
    : releases.map(({ version, lines }) => {
        if (releases.length === 1) {
          return block(lines);
        }
        const heading = element("h3", "");
        heading.append(element("span", "new-in-version", `New in v${version}`));
        const date = dateOf?.(version);
        if (date !== undefined) {
          heading.append(element("span", "new-in-date muted", date));
        }
        return block(lines, heading);
      });
  getElementById("new-in-blocks").replaceChildren(...(releases.length === 0 ? [] : blocks));
}
