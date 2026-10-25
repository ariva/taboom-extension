// Tag operations of the side panel: the entry keys behind rows, the tag filter, recolor and
// remove. Tags stick to page addresses, so a live tab and a parked row are tagged the same
// way; the storage writers do the list edits. A new tag is made inside the picker.
import { hostnameOf, isSupportedUrl } from "../../../app/core.ts";
import { editTag, removeTagsToTrash } from "../../../app/storage.ts";
import { TAG_COLORS, type TagOrigin, tagOriginSets, tagPageKey } from "../../../app/tags.ts";
import { refresh, render } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";
import { persistUiPrefs } from "../input/toolbar-events.ts";

export const TAG_SWATCHES = Object.entries(TAG_COLORS) as [name: string, hex: string][];

// what the Tag URL… / Tag domain… pickers edit: the page entry, or the site entry (the bare host)
export type TagScope = "page" | "site";

// the entry keys behind row ids (live or parked), deduped; unsupported urls drop out — a
// site needs a web host (chrome://settings has a hostname "settings", no site to tag)
export function tagPageUrls(tabIds: number[], scope: TagScope = "page"): string[] {
  const ids = new Set(tabIds);
  const keys = state.allTabs.flatMap((tab) => {
    if (!ids.has(tab.id)) {
      return [];
    }
    const url = tab.url || tab.pendingUrl;
    const key = scope === "site" ? (isSupportedUrl(url) ? hostnameOf(url) : "") : tagPageKey(url);
    return key === "" ? [] : [key];
  });
  return [...new Set(keys)];
}

// the tags these rows carry (any of them) with every entry kind each comes from — the glyph
// after a name in the Tag URL… / Tag domain… picker
export function rowTagOrigins(tabIds: number[]): Map<string, Set<TagOrigin>> {
  const ids = new Set(tabIds);
  const origins = new Map<string, Set<TagOrigin>>();
  for (const tab of state.allTabs) {
    if (!ids.has(tab.id)) {
      continue;
    }
    for (const [tagId, set] of tagOriginSets(state.tagPages, tab.url || tab.pendingUrl)) {
      origins.set(tagId, new Set([...(origins.get(tagId) ?? []), ...set]));
    }
  }
  return origins;
}

// quick launch row click: the list shows that tag alone (the chip's tick set becomes this tag)
export function filterByTag(tagId: string): void {
  state.filter = "tags";
  state.tagFilter = new Set([tagId]);
  persistUiPrefs();
  render(false);
}

export async function recolorTagById(tagId: string, color: string): Promise<void> {
  await editTag(tagId, { color });
  refresh(true);
}

// Remove tag: it leaves every page; Settings → Tags → Restore last removal brings it back
export async function removeTag(tagId: string): Promise<void> {
  state.tagFilter.delete(tagId);
  await removeTagsToTrash([tagId]);
  refresh(true);
}
