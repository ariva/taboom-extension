// Tagged-page patterns as pure functions: what an entry's `url` may be, how a typed one is
// normalized, and the one rule saying whether a page falls under it. No DOM, no chrome.*.
import { hostnameOf, matchesRule } from "./core.ts";
import { duplicateKey, NEW_TAB_KEY } from "./duplicates.ts";

// the key a page is tagged by: the address without its fragment. Any page with an address —
// chrome:// and extension pages included (a label needs no reload, unlike keep-alive) — except
// the New Tab page: every new tab shares that address, so a tag there would land on all of them
export function tagPageKey(url: string | undefined): string {
  const key = duplicateKey(url);
  return key === NEW_TAB_KEY || !key.includes(":") ? "" : key;
}

// ---------- tagged-page patterns ----------
// An entry's `url` is a pattern: an address (exact page, `https://a.test/x`; ending in `/` it
// covers everything under it — `https://a.test/` is the whole site without typing `*`), a site
// (`a.test`: the host and its subdomains — www, m, public… — unlike a protection rule's exact
// host; `*.a.test` says the same and stays for entries saved that way), a word (`youtube`, no
// dot: every host containing it) or a glob — `*` anywhere, matching anything, `/` and `?`
// included (`https://github.com/ariva/*/test`). Entries saved before patterns existed are addresses.

function isAddressPattern(pattern: string): boolean {
  return pattern.includes("://");
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
  return pattern.includes("*") || !pattern.includes(".") ? "pattern" : "domain";
}

// the host a row's Tag domain… tags: a leading www. is dropped so the entry names the site and
// covers www and bare alike (kept when nothing else would be left, `www.com`)
export function siteOf(url: string | undefined): string {
  const host = hostnameOf(url);
  const bare = host.replace(/^www\./, "");
  return bare.includes(".") ? bare : host;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// a typed pattern (options Add row, the address edit): an address goes through URL() like a
// tab url (lowercased host, trailing slash, no fragment); a scheme-less path gets https; a
// glob keeps its path as typed, only the scheme and host are lowered; a bare host is a site.
// "" for junk, a host with a space, or a glob that would cover every page
export function tagPagePatternFromInput(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) {
    return "";
  }
  if (!SCHEME.test(trimmed) && !trimmed.includes("/")) {
    const site = trimmed.toLowerCase();
    return site.replace(/\*/g, "") === "" || site.replace(/^\*\./, "") === "" ? "" : site;
  }
  const address = SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!address.includes("*")) {
    try {
      return tagPageKey(new URL(address).href);
    } catch {
      return "";
    }
  }
  const glob = address.split("#")[0] ?? "";
  return glob.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)/i, (authority) => authority.toLowerCase());
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
  return pattern.includes(".") ? `${pattern} and its subdomains` : `Hosts containing ${pattern}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// one RegExp per glob, built once: tagsForUrl runs over every tab × every entry per refresh
const globs = new Map<string, RegExp>();

function globMatches(pattern: string, text: string): boolean {
  let regExp = globs.get(pattern);
  if (!regExp) {
    regExp = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);
    globs.set(pattern, regExp);
  }
  return regExp.test(text);
}

// the one rule for "is this page under the pattern" — every surface (badges, menus, the
// search haystack, the picker's inherited ticks) compares through here
export function matchesTagPage(pattern: string, url: string | undefined): boolean {
  const key = tagPageKey(url);
  if (key === "" || pattern === "") {
    return false;
  }
  if (isAddressPattern(pattern)) {
    if (pattern.includes("*")) {
      return globMatches(pattern, key);
    }
    return pattern.endsWith("/") ? key.startsWith(pattern) : pattern === key;
  }
  const host = hostnameOf(key);
  if (host === "") {
    return false;
  }
  if (pattern.includes("*")) {
    return matchesRule(host, { pattern }) || globMatches(pattern, host);
  }
  return pattern.includes(".") ? matchesRule(host, { pattern: `*.${pattern}` }) : host.includes(pattern);
}
