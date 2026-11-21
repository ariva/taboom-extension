// Custom tab names as pure functions: a rule is a pattern (the tagged-page vocabulary,
// tag-patterns.ts) and the name the side panel shows in place of the tab's title. The first
// enabled rule in stored order wins, so the Settings drag order matters and a name set from a
// row menu goes first. No DOM, no chrome.* — the panel and Settings go through here.
import { setItemEnabled } from "../lib/list.ts";
import { popRemoval } from "./removal-trash.ts";
import { matchesTagPageKey, pageKeyOf, tagPagePatternFromInput } from "./tag-patterns.ts";
import type { Removal, TabName } from "./types.ts";

// the rule naming this page, if any — parsed once per tab (deriveTabs runs this per refresh)
export function tabNameFor(list: TabName[], url: string | undefined): TabName | undefined {
  const page = pageKeyOf(url);
  return page.key === "" ? undefined : list.find((rule) => !rule.disabled && matchesTagPageKey(rule.pattern, page));
}

export function makeTabName(pattern: string, name: string): TabName {
  return { id: crypto.randomUUID(), pattern, name, createdAt: Date.now() };
}

// the row menu's Rename tab: the rule keyed by this exact pattern takes the name (and comes back on —
// renaming a switched-off rule means wanting it); none → a new rule FIRST, so it beats a wider rule
// already naming the page. undefined for a blank name, an untaggable page ("" pattern) or no change
export function setTabName(list: TabName[], pattern: string, name: string): TabName[] | undefined {
  const text = name.trim();
  if (text === "" || pattern === "") {
    return undefined;
  }
  const own = list.find((rule) => rule.pattern === pattern);
  if (!own) {
    return [makeTabName(pattern, text), ...list];
  }
  if (own.name === text && !own.disabled) {
    return undefined;
  }
  const { disabled: _off, ...live } = own;
  return list.map((rule) => (rule === own ? { ...live, name: text } : rule));
}

// Settings "On" box: off keeps the rule listed but it names nothing; the key is absent when on
export function setTabNameEnabled(list: TabName[], id: string, enabled: boolean): TabName[] | undefined {
  return setItemEnabled(
    list,
    list.find((rule) => rule.id === id),
    enabled,
  );
}

// Settings name edit: trimmed; undefined when unknown, blank or unchanged
export function setTabNameLabel(list: TabName[], id: string, name: string): TabName[] | undefined {
  const text = name.trim();
  const own = list.find((rule) => rule.id === id);
  if (!own || text === "" || own.name === text) {
    return undefined;
  }
  return list.map((rule) => (rule === own ? { ...own, name: text } : rule));
}

// Settings pattern edit: re-keyed through the tagged-page normalizer, id and createdAt kept;
// undefined when unknown, junk, unchanged or another rule has the pattern
export function setTabNamePattern(list: TabName[], id: string, text: string): TabName[] | undefined {
  const own = list.find((rule) => rule.id === id);
  const pattern = tagPagePatternFromInput(text);
  if (!own || pattern === "" || pattern === own.pattern || list.some((rule) => rule.pattern === pattern)) {
    return undefined;
  }
  return list.map((rule) => (rule === own ? { ...own, pattern } : rule));
}

// Settings → Restore: the newest removal back, except a pattern listed again meanwhile (the
// current rule wins). undefined when nothing to restore
export function restoreTabNameRemoval(
  list: TabName[],
  trash: Removal<TabName>[],
): { tabNames: TabName[]; tabNamesTrash: Removal<TabName>[] } | undefined {
  const popped = popRemoval(trash);
  if (!popped) {
    return undefined;
  }
  const patterns = new Set(list.map((rule) => rule.pattern));
  const returning = popped.newest.items.filter((rule) => !patterns.has(rule.pattern));
  return { tabNames: [...list, ...returning], tabNamesTrash: popped.rest };
}
