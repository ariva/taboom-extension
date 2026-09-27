// "What's new": renders the bundled CHANGES.md as one entry per release — collapsible
// behind a flag, with a fold-all toggle and a paginated Show-more.
import { featureEnabled } from "../../app/core.ts";
import { FOLD_ICONS, getElementById } from "../../lib/dom.ts";
import { releaseSections, SHOW_INITIAL_CHANGES, SHOW_MORE_PAGE } from "./model.ts";
import { getFeatures } from "./page-state.ts";

export function initWhatsNew(): void {
  const FEATURES = getFeatures();
  // What's new: bundled CHANGES.md — one collapsible per release, newest open
  fetch(chrome.runtime.getURL("CHANGES.md"))
    .then((response) => response.text())
    .then((markdown) => {
      const sections = releaseSections(markdown);
      if (sections.length === 0) {
        return;
      }
      const box = getElementById("whats-new");
      // OPTION_COLLAPSABLE_CHANGE_LOG_ITEMS off: plain always-expanded entries —
      // no per-entry chevrons, no fold-all toggle (pagination still applies)
      const collapsable = featureEnabled(FEATURES, "OPTION_COLLAPSABLE_CHANGE_LOG_ITEMS");
      for (const [index, section] of sections.entries()) {
        const title = index === 0 ? `What's new — ${section.title}` : section.title;
        const pre = document.createElement("pre");
        pre.className = "muted";
        pre.textContent = section.body;
        let entry: HTMLDetailsElement | HTMLDivElement;
        if (collapsable) {
          entry = document.createElement("details");
          entry.open = index < SHOW_INITIAL_CHANGES; // initial page expanded, rest fold
          const summary = document.createElement("summary");
          summary.textContent = title;
          entry.append(summary, pre);
        } else {
          entry = document.createElement("div");
          const heading = document.createElement("p");
          heading.className = "changes-title";
          heading.textContent = title;
          entry.append(heading, pre);
        }
        entry.classList.add("changes-entry");
        if (index >= SHOW_INITIAL_CHANGES) {
          entry.hidden = true; // revealed by the Show-all button
        }
        box.append(entry);
      }
      if (collapsable) {
        // fold-all icon toggle pinned top-right, same icons and semantics as the
        // sidepanel one: all collapsed → unfold glyph/"Click to Expand", otherwise
        // fold/"Click to Collapse". Applies to every release, so ones revealed
        // later by Show-more come up matching the chosen state.
        const toggleAll = document.createElement("button");
        toggleAll.id = "changes-toggle";
        const allDetails = [...box.querySelectorAll("details")];
        const syncToggleAll = () => {
          const allCollapsed = allDetails.every((d) => !d.open);
          toggleAll.innerHTML = allCollapsed ? FOLD_ICONS.unfold : FOLD_ICONS.fold;
          toggleAll.title = toggleAll.ariaLabel = allCollapsed ? "Click to Expand" : "Click to Collapse";
        };
        toggleAll.addEventListener("click", () => {
          const expand = allDetails.every((d) => !d.open);
          for (const entry of allDetails) {
            entry.open = expand;
          }
          syncToggleAll();
        });
        syncToggleAll();
        box.prepend(toggleAll);
      }
      if (sections.length > SHOW_INITIAL_CHANGES) {
        // paginated reveal: each click shows the next SHOW_MORE_PAGE releases;
        // the button disappears once the last one is visible
        const showMore = document.createElement("button");
        showMore.id = "changes-more";
        const hiddenNow = () => [...box.querySelectorAll<HTMLElement>(".changes-entry[hidden]")];
        const updateLabel = () => {
          showMore.textContent = `Show ${Math.min(SHOW_MORE_PAGE, hiddenNow().length)} more`;
        };
        showMore.addEventListener("click", () => {
          for (const hiddenSection of hiddenNow().slice(0, SHOW_MORE_PAGE)) {
            hiddenSection.hidden = false;
          }
          if (hiddenNow().length === 0) {
            showMore.remove();
          } else {
            updateLabel();
          }
        });
        updateLabel();
        box.append(showMore);
      }
      box.hidden = false;
    })
    .catch(() => {}); // CHANGES.md missing from a dev checkout — section stays hidden
}
