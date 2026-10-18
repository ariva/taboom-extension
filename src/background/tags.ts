// TAGS in the page context menu: a "Tag page ▸" submenu with one checkbox per tag
// (existing tags only — tags are made in the side panel or Settings). The items follow
// the tag list; the checks follow the active tab's page.
import { applyExperimental, featureEnabled } from "../app/core.ts";
import { loadState, localStore, toggleTagOnPages } from "../app/storage.ts";
import { orderedTags, tagPageKey, tagsForUrl } from "../app/tags.ts";
import type { Tag } from "../app/types.ts";
import { enqueueMenuOp, registerTagMenuBuilder, removeMenu } from "./context-menus.ts";
import { getFeatures } from "./nav-mode.ts";

export const TAG_MENU_ID = "tag-page";
const TAG_ITEM_PREFIX = "tag-";

export function tagIdOfMenuItem(menuItemId: string | number): string | undefined {
  return typeof menuItemId === "string" && menuItemId.startsWith(TAG_ITEM_PREFIX) && menuItemId !== TAG_MENU_ID
    ? menuItemId.slice(TAG_ITEM_PREFIX.length)
    : undefined;
}

async function tagsActive(): Promise<boolean> {
  const [{ ui }, features] = await Promise.all([loadState(), getFeatures()]);
  return featureEnabled(applyExperimental(features, ui.showExperimental ?? false), "TAGS");
}

// the tags the menu lists: none while the flag is off
async function activeTags(): Promise<Tag[]> {
  if (!(await tagsActive())) {
    return [];
  }
  const [{ ui }, { tags = [], tagPages = [] }] = await Promise.all([loadState(), localStore.get(["tags", "tagPages"])]);
  return orderedTags(tags, tagPages, ui); // the Settings picker order, switched-off tags left out
}

// inside a menu pass (createContextMenus / rebuildTagMenu): the parent exists only with a tag to pick
export async function createTagMenuItems(): Promise<void> {
  const tags = await activeTags();
  if (tags.length === 0) {
    return;
  }
  const [{ tagPages = [] }, [active]] = await Promise.all([
    localStore.get("tagPages"),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
  ]);
  const checked = new Set(tagsForUrl(tagPages, tags, active?.url).map((tag) => tag.id));
  // no documentUrlPatterns: any page with an address can carry a tag (the click guards New Tab)
  chrome.contextMenus.create({
    id: TAG_MENU_ID,
    title: "Tag page",
    parentId: "root",
    contexts: ["page"],
  });
  for (const tag of tags) {
    chrome.contextMenus.create({
      id: `${TAG_ITEM_PREFIX}${tag.id}`,
      parentId: TAG_MENU_ID,
      title: tag.name,
      type: "checkbox",
      checked: checked.has(tag.id),
      contexts: ["page"],
    });
  }
}

registerTagMenuBuilder(createTagMenuItems);

// storage.onChanged("tags" / "ui"): the list or the flag changed — rebuild the submenu
export function rebuildTagMenu(): Promise<unknown> {
  return enqueueMenuOp(async () => {
    await removeMenu(TAG_MENU_ID); // children go with the parent
    await createTagMenuItems();
  });
}

// tabs.onActivated / navigation / tagPages change: the checks match the active page
export async function syncTagMenu(tab: chrome.tabs.Tab | null | undefined): Promise<void> {
  if (!tab || tagPageKey(tab.url) === "") {
    return;
  }
  const tags = await activeTags();
  if (tags.length === 0) {
    return;
  }
  const { tagPages = [] } = await localStore.get("tagPages");
  const checked = new Set(tagsForUrl(tagPages, tags, tab.url).map((tag) => tag.id));
  await enqueueMenuOp(() =>
    Promise.all(
      tags.map(
        (tag) =>
          new Promise((resolve) =>
            chrome.contextMenus.update(`${TAG_ITEM_PREFIX}${tag.id}`, { checked: checked.has(tag.id) }, () => {
              void chrome.runtime.lastError; // item absent mid-rebuild — the rebuild seeds the state
              resolve(undefined);
            }),
          ),
      ),
    ),
  );
}

export async function syncTagMenuOnNavigation(
  _tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
): Promise<void> {
  if (changeInfo.url && tab?.active) {
    await syncTagMenu(tab);
  }
}

// context menu click: flip that tag on the clicked page
export async function toggleTagForTab(tab: chrome.tabs.Tab, tagId: string): Promise<void> {
  const key = tagPageKey(tab.url);
  if (key === "") {
    return; // the New Tab page, or no address
  }
  const { tags = [], tagPages = [] } = await localStore.get(["tags", "tagPages"]);
  const has = tagsForUrl(tagPages, tags, tab.url).some((tag) => tag.id === tagId);
  await toggleTagOnPages([key], tagId, !has);
  await syncTagMenu(tab);
}
