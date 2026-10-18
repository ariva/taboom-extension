// The Tags… entry of the row menus (live and parked rows) and the quick launch's tag menu
// (rename / color / remove / undo).
import { TAG_COLORS } from "../../../app/tags.ts";
import {
  clearCtxMenu,
  ctxAppend,
  ctxDivider,
  ctxItem,
  ctxSubmenu,
  ctxTitle,
  showCtxMenu,
} from "../../../lib/ui/context-menu.ts";
import { state } from "../foundation/state.ts";
import { openTagAssignPicker } from "../input/tag-assign-picker.ts";
import { newTagForTabs, recolorTagById, removeTag, tagPageUrls } from "../ops/tag-ops.ts";

// Tags…: the checklist picker (input/tag-assign-picker.ts) opens at the click — ticking
// several tags needs no re-opening, like Settings → Tagged pages
export function appendTagItems(ids: number[], at: Pick<MouseEvent, "clientX" | "clientY">, reopen: () => void): void {
  if (tagPageUrls(ids).length === 0) {
    return; // nothing taggable (chrome:// pages)
  }
  // the menu closes, the picker takes its place; Cancel / ✕ bring the menu back (reopen)
  ctxAppend(ctxItem("Tags…", () => openTagAssignPicker(at, ids, reopen)));
  ctxAppend(ctxItem("New tag…", () => newTagForTabs(ids, reopen, at))); // opens where the menu was; Cancel brings the menu back
}

// the quick launch's Tags rows: rename edits the row there
export interface TagMenuHost {
  rename: (tagId: string) => void;
}

export function openTagMenu(event: MouseEvent, tagId: string, host: TagMenuHost): void {
  const tag = state.tags.find((candidate) => candidate.id === tagId);
  if (!tag) {
    return;
  }
  clearCtxMenu();
  ctxAppend(ctxTitle(tag.name), ctxDivider());
  ctxAppend(ctxItem("Rename tag…", () => host.rename(tagId)));
  const color = ctxSubmenu("Tag color");
  ctxAppend(color.btn, color.submenu);
  for (const [colorName, hex] of Object.entries(TAG_COLORS)) {
    const item = ctxItem(colorName[0]?.toUpperCase() + colorName.slice(1), () => recolorTagById(tagId, colorName));
    const dot = document.createElement("span");
    dot.className = "win-dot";
    dot.style.background = hex;
    item.prepend(dot);
    if (colorName === tag.color) {
      item.classList.add("current");
    }
    color.submenu.append(item);
  }
  ctxAppend(
    ctxDivider(),
    ctxItem("Remove tag", () => removeTag(tagId)),
  );
  showCtxMenu(event);
}
