// Tagged-page patterns as pure functions: what an entry's `url` may be, how a typed one is
// normalized, and the one rule saying whether a page falls under it. No DOM, no chrome.*.
import { hasPort, hostOf, matchesRule } from "./core.ts";
import { duplicateKey, NEW_TAB_KEY } from "./duplicates.ts";

// the key a page is tagged by: the address, with its fragment when `keepFragment` says so
// (settings.tagPagesKeepFragment — hash-routed pages differ only there; a lone trailing # is
// noise) and without it otherwise. Any page with an address — chrome:// and extension pages
// included (a label needs no reload, unlike keep-alive) — except the New Tab page: every new
// tab shares that address, so a tag there would land on all of them
export function tagPageKey(url: string | undefined, keepFragment = false): string {
  const key = duplicateKey(url);
  if (key === NEW_TAB_KEY || !key.includes(":")) {
    return "";
  }
  return keepFragment ? (url ?? "").replace(/#$/, "") : key;
}

// ---------- tagged-page patterns ----------
// An entry's `url` is a pattern: an address (exact page, `https://a.test/x`; ending in `/` it
// covers everything under it — `https://a.test/` is the whole site without typing `*`), a site
// (`a.test`: the host and its subdomains — www, m, public… — unlike a protection rule's exact
// host; `*.a.test` says the same and stays for entries saved that way), a word (`youtube`, no
// dot: every host containing it) or a glob — `*` anywhere, matching anything, `/` and `?`
// included (`https://github.com/ariva/*/test`). Entries saved before patterns existed are addresses.

// an address has a scheme — `about:debugging#/setup` as much as `https://a.test/x`; `localhost:9000`
// (digits up to the end or a /) is a host with a port, not a scheme. Keep-alive asks the same question
export function isAddressPattern(pattern: string): boolean {
  return SCHEME.test(pattern);
}

// a host (a dot, or a port: `localhost:9000`) as opposed to a word (`youtube`)
function isHostPattern(pattern: string): boolean {
  return pattern.includes(".") || hasPort(pattern);
}

// what kind of entry a stored pattern is, for the badge glyph: a page address, a domain (a host
// or *.host), or a pattern (a prefix or a glob)
export function tagPatternKind(pattern: string): "page" | "domain" | "pattern" {
  if (isAddressPattern(pattern)) {
    return pattern.includes("*") || pattern.endsWith("/") ? "pattern" : "page";
  }
  if (pattern.startsWith("*.") && !pattern.slice(2).includes("*")) {
    return "domain";
  }
  return pattern.includes("*") || !isHostPattern(pattern) ? "pattern" : "domain";
}

// the host a row's Tag domain… tags: a leading www. is dropped so the entry names the site and
// covers www and bare alike (kept when nothing else would be left, `www.com`)
export function siteOf(url: string | undefined): string {
  const host = hostOf(url);
  const bare = host.replace(/^www\./, "");
  return bare.includes(".") ? bare : host;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d+(\/|$))/i;

// a typed pattern (options Add row, the address edit): an address goes through URL() like a
// tab url (lowercased host, trailing slash); a scheme-less path gets https; a glob keeps its
// path as typed, only the scheme and host are lowered; a bare host is a site. The fragment
// stays — a stored key may carry one, and a lookup must never lose what the entry has; the
// Settings page strips it before calling when the setting is off. "" for junk, a host with a
// space, or a glob that would cover every page
export function tagPagePatternFromInput(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) {
    return "";
  }
  if (!isAddressPattern(trimmed) && !trimmed.includes("/")) {
    const site = trimmed.toLowerCase();
    return site.replace(/\*/g, "") === "" || site.replace(/^\*\./, "") === "" ? "" : site;
  }
  const address = isAddressPattern(trimmed) ? trimmed : `https://${trimmed}`;
  if (!address.includes("*")) {
    try {
      return tagPageKey(new URL(address).href, true);
    } catch {
      return "";
    }
  }
  return address.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)/i, (authority) => authority.toLowerCase());
}

// what a pattern covers, for a tooltip beside the pattern text
export function tagPagePatternHint(pattern: string): string {
  if (isAddressPattern(pattern)) {
    if (pattern.includes("*")) {
      return "Pages matching the pattern";
    }
    return pattern.endsWith("/") ? "Every page under" : "Exact page";
  }
  if (pattern.includes("*")) {
    return pattern.startsWith("*.") && !pattern.slice(2).includes("*")
      ? `${pattern.slice(2)} and its subdomains`
      : "Hosts matching the pattern";
  }
  return isHostPattern(pattern) ? `${pattern} and its subdomains` : `Hosts containing ${pattern}`;
}

// `*` matches anything, so the glob is walked segment by segment: the first segment must open
// the text, the last must close it, the ones between are found in order (the leftmost place is
// always right). A RegExp built from the same stars (`a.*b.*c`) backtracks exponentially on a
// page that does not match — a dozen stars froze the panel, Settings and the worker.
function globMatches(pattern: string, text: string): boolean {
  const segments = pattern.split("*");
  const first = segments[0] ?? "";
  const last = segments[segments.length - 1] ?? "";
  if (segments.length === 1) {
    return text === first;
  }
  if (!text.startsWith(first)) {
    return false;
  }
  let position = first.length;
  for (const segment of segments.slice(1, -1)) {
    const found = text.indexOf(segment, position);
    if (found === -1) {
      return false;
    }
    position = found + segment.length;
  }
  return text.length - position >= last.length && text.endsWith(last);
}

// what one url resolves to for matching — computed once per tab, not once per (tab, entry) pair:
// deriveTabs matches every tab against every entry on each refresh, and the url parse is the cost
export interface PageKey {
  key: string; // the page key without its fragment ("" = never tagged)
  host: string; // its hostname ("" when the key has none)
  url: string; // the address with its fragment — what an entry keyed with a # compares against
}

export function pageKeyOf(url: string | undefined): PageKey {
  const key = tagPageKey(url);
  return key === "" ? { key, host: "", url: "" } : { key, host: hostOf(key), url: tagPageKey(url, true) };
}

// the one rule for "is this page under the pattern" — every surface (badges, menus, the
// search haystack, the picker's inherited ticks) compares through here
export function matchesTagPage(pattern: string, url: string | undefined): boolean {
  return matchesTagPageKey(pattern, pageKeyOf(url));
}

// like keep-alive: an entry with a # is matched on the full address (hash-routed apps —
// /#/dashboard is not /#/mail), one without covers every fragment
export function matchesTagPageKey(pattern: string, { key, host, url }: PageKey): boolean {
  if (key === "" || pattern === "") {
    return false;
  }
  if (isAddressPattern(pattern)) {
    const text = pattern.includes("#") ? url : key;
    if (pattern.includes("*")) {
      return globMatches(pattern, text);
    }
    return pattern.endsWith("/") ? text.startsWith(pattern) : pattern === text;
  }
  if (host === "") {
    return false;
  }
  if (pattern.includes("*")) {
    return matchesRule(host, { pattern }) || globMatches(pattern, host);
  }
  return isHostPattern(pattern) ? matchesRule(host, { pattern: `*.${pattern}` }) : host.includes(pattern);
}
