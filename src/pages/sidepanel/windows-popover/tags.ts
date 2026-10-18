// Tags view of the quick launch: one row per tag (color dot, name, how many open tabs and
// windows carry it) — click filters the list to that tag, ⋯ / right-click opens the tag menu,
// whose Rename edits the row in place.
import { editTag } from "../../../app/storage.ts";
import { tagColorHex, tagNameError } from "../../../app/tags.ts";
import type { Tag } from "../../../app/types.ts";
import { inlineEdit } from "../../../lib/ui/inline-edit.ts";
import { toast } from "../../../lib/ui/toast.ts";
import { winPop } from "../foundation/elements.ts";
import { refresh } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";
import type { PanelTab } from "../foundation/state.ts";
import { filterByTag } from "../ops/tag-ops.ts";

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function fillTagRows(tags: Tag[], tabs: PanelTab[], onMenu: (event: MouseEvent, tagId: string) => void): void {
  for (const tag of tags) {
    // live tabs only: the derived map covers the list's tabs, parked rows included in that scope
    const tagged = tabs.filter((tab) => state.derived.get(tab.id)?.tags.some((known) => known.id === tag.id));
    const windows = new Set(tagged.map((tab) => tab.windowId)).size;
    const row = document.createElement("button");
    row.type = "button";
    row.className = tagged.length === 0 ? "win-row missing" : "win-row";
    row.dataset.tagId = tag.id; // right-click → tag menu
    const dot = document.createElement("span");
    dot.className = "win-dot";
    dot.style.background = tagColorHex(tag.color);
    const name = document.createElement("span");
    name.className = "win-title";
    name.textContent = tag.name;
    const stats = document.createElement("span");
    stats.className = "win-stats muted";
    stats.textContent =
      tagged.length === 0 ? "no open tab" : `${countOf(tagged.length, "tab")} · ${countOf(windows, "window")}`;
    row.append(dot, name, stats);
    row.title = [tag.name, stats.textContent, ...tagged.map((tab) => tab.title || tab.url)].join("\n");
    row.addEventListener("click", () => {
      winPop.hidePopover?.();
      filterByTag(tag.id);
    });
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "win-menu-btn";
    menuBtn.title = menuBtn.ariaLabel = "Tag actions";
    menuBtn.textContent = "⋯";
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      onMenu(event, tag.id);
    });
    const item = document.createElement("div");
    item.className = "win-item";
    item.append(row, menuBtn);
    winPop.append(item);
  }
}

// rename without leaving the popover: swap the row's name for the input
export function startRenameTagInList(tagId: string, refill: () => void): void {
  const tag = state.tags.find((candidate) => candidate.id === tagId);
  const title = winPop.querySelector(`.win-row[data-tag-id="${tagId}"] .win-title`);
  if (!tag || !title) {
    return;
  }
  inlineEdit(title, {
    initial: tag.name,
    placeholder: "Tag name",
    commit: async (name) => {
      const error = name.trim() === tag.name ? undefined : tagNameError(state.tags, name, tag.id);
      if (error) {
        toast(error); // the row snaps back to the stored name on refill
        return;
      }
      await editTag(tag.id, { name });
    },
    // the name is read back from storage: refill once state.tags carries it
    finish: () => {
      refresh(false).then(refill);
    },
  });
}
