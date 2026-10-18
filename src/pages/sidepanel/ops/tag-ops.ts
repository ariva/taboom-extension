// Tag operations of the side panel: toggle a tag over the clicked / selected rows, the
// New tag… dialog. Tags stick to page addresses, so a live tab and a parked row are
// tagged the same way; the storage writers do the list edits.
import { addTag, editTag, removeTagsToTrash, toggleTagOnPages } from "../../../app/storage.ts";
import { TAG_COLORS, tagNameError, tagPageKey } from "../../../app/tags.ts";
import { askDialog } from "../../../lib/ui/ask-dialog.ts";
import { toast } from "../../../lib/ui/toast.ts";
import { refresh, render } from "../foundation/scheduler.ts";
import { state } from "../foundation/state.ts";
import { persistUiPrefs } from "../input/toolbar-events.ts";

export const TAG_SWATCHES = Object.entries(TAG_COLORS) as [name: string, hex: string][];

// the page keys behind row ids (live or parked); unsupported urls drop out
export function tagPageUrls(tabIds: number[]): string[] {
  const ids = new Set(tabIds);
  return state.allTabs.flatMap((tab) => {
    const key = ids.has(tab.id) ? tagPageKey(tab.url || tab.pendingUrl) : "";
    return key === "" ? [] : [key];
  });
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

// New tag…: name + color in one dialog; the tag is created and applied to the rows at once.
// reopen: the row menu the item came from — Cancel / ✕ bring it back (Esc, the backdrop and a
// blur just close); at: where that menu was — the dialog opens there, not under the toolbar
export async function newTagForTabs(
  tabIds: number[],
  reopen: (() => void) | null = null,
  at: Pick<MouseEvent, "clientX" | "clientY"> | null = null,
): Promise<void> {
  let color = "blue";
  const name = await askDialog({
    message: "New tag",
    input: { placeholder: "Tag name" },
    near: at,
    closeButton: true,
    onCancel: (reason) => {
      if (reason === "button") {
        reopen?.();
      }
    },
    validate: (value) => tagNameError(state.tags, value), // a taken name keeps the dialog open and says so
    swatches: {
      colors: TAG_SWATCHES,
      initial: color,
      onConfirm: (picked) => {
        color = picked;
      },
    },
    okLabel: "Add",
  });
  if (typeof name !== "string") {
    return; // onCancel decided whether the menu comes back
  }
  const tag = await addTag(name, color);
  if (!tag) {
    toast("Could not add the tag"); // the list changed under us (another page added the name)
    return;
  }
  await toggleTagOnPages(tagPageUrls(tabIds), tag.id, true);
  refresh(true);
}
