// Rename tab: the row menu's one question. The name is a rule for the page (tag-pattern key, so
// it survives a restart and covers every tab on the page) that the row shows in place of the
// tab's title — the browser's own tab strip is out of reach without a content script.
import { editTabNames, dropTabNames } from "../../../app/storage.ts";
import { setTabName } from "../../../app/tab-names.ts";
import { tagPageKey } from "../../../app/tags.ts";
import { askDialog } from "../../../lib/ui/ask-dialog.ts";
import { toast } from "../../../lib/ui/toast.ts";
import { state, tabById } from "../foundation/state.ts";

export async function renameTab(tabId: number): Promise<void> {
  const tab = tabById(tabId);
  const pattern = tagPageKey(tab?.url || tab?.pendingUrl, state.tagPagesKeepFragment);
  if (!tab || pattern === "") {
    toast("This page cannot be named"); // the New Tab page: every new tab shares its address
    return;
  }
  const current = state.derived.get(tabId)?.name ?? tab.title ?? "";
  const answer = await askDialog({
    message: "Name shown for this tab in the side panel",
    input: { initial: current, placeholder: tab.title ?? "" },
  });
  if (typeof answer !== "string") {
    return; // cancelled
  }
  const name = answer.trim();
  if (name === "") {
    // a blank answer takes the page's own rule away (restorable in Settings); a wider rule naming the
    // page stays — it is edited in Settings → Tab names
    await dropTabNames((list) => list.filter((rule) => rule.pattern !== pattern));
    return;
  }
  await editTabNames((list) => setTabName(list, pattern, name));
}
