// The synthetic world every recording is made of. Nothing here comes from a real profile:
// hosts end in `.test` (answered from memory by browser.ts, never from the network), titles,
// window names and tags are invented, and a fixed seed makes two runs build the same world.

export interface DemoWindow {
  key: string; // stable handle for the scenes ("work", "research", …)
  name: string; // shown through the extension's window names
  color: string; // one of the panel's window dot colors (model/windows.ts WINDOW_DOT_COLORS)
  pinnedWindow?: boolean;
  stage: boolean; // stage windows hold the curated tabs the scenes act on; filler windows only add scale
  tabCount: number;
}

export interface DemoTab {
  windowKey: string;
  url: string; // unique per tab (the path carries a counter), so a page maps back to its tab
  title: string;
  host: string;
  pinned?: boolean;
  snoozed?: boolean; // discarded by chrome.tabs.discard after it loaded
  group?: string; // key into GROUPS
  tags?: string[]; // tag ids
}

export interface DemoGroup {
  key: string;
  windowKey: string;
  title: string;
  color: string; // chrome.tabGroups color name
}

export const WINDOWS: DemoWindow[] = [
  { key: "work", name: "Work", color: "#17bebb", stage: true, tabCount: 14 },
  { key: "research", name: "Research", color: "#8a4fff", stage: true, tabCount: 12 },
  { key: "shopping", name: "Shopping", color: "#ffc914", stage: true, tabCount: 11 },
  { key: "media", name: "Media", color: "#e4572e", pinnedWindow: true, stage: true, tabCount: 12 },
  { key: "f1", name: "Reading list", color: "#2ec4b6", stage: false, tabCount: 80 },
  { key: "f2", name: "Travel", color: "#ff6b9d", stage: false, tabCount: 75 },
  { key: "f3", name: "Finance", color: "#c9b037", stage: false, tabCount: 70 },
  { key: "f4", name: "Side project", color: "#9aa0a6", stage: false, tabCount: 76 },
  { key: "f5", name: "Courses", color: "#17bebb", stage: false, tabCount: 78 },
  { key: "f6", name: "Recipes", color: "#8a4fff", stage: false, tabCount: 71 },
];

export const GROUPS: DemoGroup[] = [
  { key: "sprint", windowKey: "work", title: "Sprint 42", color: "blue" },
  { key: "reviews", windowKey: "work", title: "Reviews", color: "green" },
  { key: "papers", windowKey: "research", title: "Papers", color: "purple" },
  { key: "gifts", windowKey: "shopping", title: "Gifts", color: "pink" },
];

export const TAGS = [
  { id: "tag-work", name: "work", color: "blue" },
  { id: "tag-bills", name: "bills", color: "yellow" },
  { id: "tag-later", name: "read later", color: "green" },
  { id: "tag-urgent", name: "urgent", color: "red" },
];

// hosts × page kinds: the title reads like a real tab, the host stays obviously fake
const SITES: { host: string; pages: string[] }[] = [
  {
    host: "docs.example.test",
    pages: ["Quarterly report — Sheets", "Roadmap 2027 — Docs", "Budget draft — Sheets", "Team notes — Docs"],
  },
  { host: "mail.example.test", pages: ["Inbox (12) — Mail", "Invoice #4471 — Mail", "Re: offsite agenda — Mail"] },
  {
    host: "code.example.test",
    pages: [
      "PR #812: tags picker — Code",
      "Issue #77: slow scroll — Code",
      "main · taboom — Code",
      "CI run #5531 — Code",
    ],
  },
  { host: "wiki.example.test", pages: ["Onboarding — Wiki", "Release checklist — Wiki", "Style guide — Wiki"] },
  { host: "news.example.test", pages: ["Morning briefing — News", "Markets today — News", "Science weekly — News"] },
  {
    host: "shop.example.test",
    pages: ["Standing desk — Shop", "Noise-cancelling headphones — Shop", "Cart (3) — Shop", "Order #20931 — Shop"],
  },
  {
    host: "video.example.test",
    pages: ["Keyboard shortcuts in 10 min — Video", "Lo-fi beats — Video", "Conference keynote — Video"],
  },
  { host: "music.example.test", pages: ["Focus playlist — Music", "New releases — Music"] },
  {
    host: "papers.example.test",
    pages: ["Attention is all you need — Papers", "Tab management at scale — Papers", "Memory of browsers — Papers"],
  },
  { host: "maps.example.test", pages: ["Office → airport — Maps", "Lunch nearby — Maps"] },
  { host: "bank.example.test", pages: ["Statement — Bank", "Transfer — Bank"] },
  { host: "recipes.example.test", pages: ["Sourdough, day 3 — Recipes", "Weeknight curry — Recipes"] },
  { host: "learn.example.test", pages: ["Week 4: closures — Learn", "Quiz 2 — Learn"] },
  { host: "travel.example.test", pages: ["Lisbon in May — Travel", "Flights LIS → VNO — Travel"] },
  { host: "chat.example.test", pages: ["#general — Chat", "DM: Alex — Chat"] },
];

const FIRST_SITE: { host: string; pages: string[] } = {
  host: "docs.example.test",
  pages: ["Quarterly report — Sheets"],
};

// pages that are open more than once on purpose (the Dupes view and Cleanup Duplicates)
const DUPLICATES: { host: string; title: string; path: string; windows: string[] }[] = [
  {
    host: "mail.example.test",
    title: "Inbox (12) — Mail",
    path: "/inbox",
    windows: ["work", "research", "shopping", "f1"],
  },
  {
    host: "docs.example.test",
    title: "Quarterly report — Sheets",
    path: "/sheets/quarterly-report",
    windows: ["work", "media"],
  },
  {
    host: "code.example.test",
    title: "PR #812: tags picker — Code",
    path: "/taboom/pull/812",
    windows: ["work", "research"],
  },
];

// a small deterministic generator: the same seed gives the same world on every run
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function buildTabs(seed = 42): DemoTab[] {
  const random = rng(seed);
  const tabs: DemoTab[] = [];
  let counter = 0;
  const fillerOverride = Number(process.env.DEMO_FILLER ?? 0);
  for (const window of WINDOWS) {
    const groups = GROUPS.filter((group) => group.windowKey === window.key);
    const tabCount = !window.stage && fillerOverride > 0 ? fillerOverride : window.tabCount;
    for (let index = 0; index < tabCount; index++) {
      const dupe = DUPLICATES.find(
        (entry) =>
          entry.windows[0] !== window.key &&
          entry.windows.includes(window.key) &&
          index === 1 + entry.windows.indexOf(window.key),
      );
      // a stage window's first (pinned, active) tab gets its own site: four windows, four pages
      const stageIndex = WINDOWS.filter((candidate) => candidate.stage).indexOf(window);
      const site =
        (window.stage && index === 0 ? SITES[stageIndex * 3] : SITES[Math.floor(random() * SITES.length)]) ??
        FIRST_SITE;
      const title = dupe?.title ?? site.pages[Math.floor(random() * site.pages.length)] ?? site.host;
      const host = dupe?.host ?? site.host;
      counter++;
      const path = dupe?.path ?? `/${slug(title)}/${counter}`;
      const tab: DemoTab = { windowKey: window.key, url: `http://${host}${path}`, title, host };
      // the first tab of a stage window is pinned; stage windows snooze a third, filler windows most
      if (window.stage && index === 0) {
        tab.pinned = true;
      }
      const snoozeShare = window.stage ? 0.3 : 0.75;
      if (index > 0 && random() < snoozeShare) {
        tab.snoozed = true;
      }
      // groups: a run of tabs in the middle of the window
      const group = groups[index >= 3 && index < 7 ? 0 : index >= 8 && index < 11 ? 1 : -1];
      if (group && window.stage) {
        tab.group = group.key;
      }
      tabs.push(tab);
    }
  }
  // the first copy of every duplicate lives in its first window: replace one plain tab there
  for (const entry of DUPLICATES) {
    const target = tabs.find(
      (tab) =>
        tab.windowKey === entry.windows[0] &&
        !tab.pinned &&
        !tab.group &&
        !tab.snoozed &&
        !DUPLICATES.some((d) => tab.url.endsWith(d.path)),
    );
    if (target) {
      target.url = `http://${entry.host}${entry.path}`;
      target.title = entry.title;
      target.host = entry.host;
    }
  }
  // tags on a handful of stage pages
  const tagged = tabs.filter((tab) => WINDOWS.find((window) => window.key === tab.windowKey)?.stage && !tab.snoozed);
  const assign = (predicate: (tab: DemoTab) => boolean, tagId: string, limit: number) => {
    let count = 0;
    for (const tab of tagged) {
      if (count < limit && predicate(tab)) {
        tab.tags = [...(tab.tags ?? []), tagId];
        count++;
      }
    }
  };
  assign((tab) => tab.host === "code.example.test" || tab.host === "docs.example.test", "tag-work", 6);
  assign(
    (tab) => tab.host === "bank.example.test" || tab.title.includes("Invoice") || tab.title.includes("Order"),
    "tag-bills",
    4,
  );
  assign((tab) => tab.host === "papers.example.test" || tab.host === "news.example.test", "tag-later", 5);
  assign((tab) => tab.title.startsWith("PR #812") || tab.title.startsWith("Issue"), "tag-urgent", 3);
  return tabs;
}

export const PROTECTED_HOSTS = ["mail.example.test", "docs.example.test", "bank.example.test"];

export const KEEP_ALIVE = [
  { url: "http://chat.example.test/general", title: "#general — Chat", minutes: 10 },
  { url: "http://mail.example.test/inbox", title: "Inbox (12) — Mail", minutes: 15 },
];

// one window that was parked a week ago: shows up under Parked windows and in the quick launch
export const PARKED = {
  name: "Conference prep",
  color: "#8a4fff",
  daysAgo: 7,
  tabs: [
    { url: "http://docs.example.test/talk-outline", title: "Talk outline — Docs" },
    { url: "http://docs.example.test/slides-v3", title: "Slides v3 — Docs", group: 0 },
    { url: "http://papers.example.test/references", title: "References — Papers", group: 0 },
    { url: "http://travel.example.test/hotel", title: "Hotel booking — Travel" },
    { url: "http://maps.example.test/venue", title: "Venue — Maps" },
  ],
  groups: [{ title: "Slides", color: "purple" }],
};

// the page a tab shows: a colored banner with the host, the title, filler text — enough for a
// window switch or a wake-up to read on screen
export function pageHtml(url: string, tabs: DemoTab[]): string {
  const tab = tabs.find((candidate) => candidate.url === url);
  const { hostname, pathname } = new URL(url);
  const title =
    tab?.title ??
    PARKED.tabs.find((candidate) => candidate.url === url)?.title ??
    KEEP_ALIVE.find((candidate) => candidate.url === url)?.title ??
    hostname;
  const hue = [...hostname].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const letter = hostname[0]?.toUpperCase() ?? "?";
  const icon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="hsl(${hue} 60% 45%)"/><text x="16" y="22" font-family="sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="${icon}">
<style>body{margin:0;font-family:system-ui,sans-serif;color:#202124;background:#fff}
header{background:hsl(${hue} 60% 45%);color:#fff;padding:18px 28px;font-size:15px;display:flex;justify-content:space-between}
main{padding:28px}h1{font-size:30px;margin:0 0 12px}p{color:#5f6368;line-height:1.6;max-width:60ch}
.card{border:1px solid #dadce0;border-radius:10px;padding:14px 18px;margin-top:14px;max-width:60ch}</style></head>
<body><header><b>${hostname}</b><span>${pathname}</span></header><main><h1>${title}</h1>
<p>Placeholder page served from memory for the Taboom demo. No network request was made to load it.</p>
<div class="card">Section one · lorem ipsum dolor sit amet, consectetur adipiscing elit.</div>
<div class="card">Section two · sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</div>
<div class="card">Section three · ut enim ad minim veniam, quis nostrud exercitation.</div></main></body></html>`;
}
