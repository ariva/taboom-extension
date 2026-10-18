// Reveal scrolling: when the active tab changes outside the panel (or the view changes), the
// current row goes to the top of the list — and when that row sits under a Split or tab-group
// sub-header, the header goes to the top with the rows under it. Layout is browser work:
// happy-dom has no geometry.
import { expect, test } from "vitest";
import { type Fixture, mountSidePanel, NOW, settle } from "./mount.ts";

const base = { windowId: 1, active: false, discarded: false, pinned: false, audible: false, groupId: -1 };
const tabs: NonNullable<Fixture["tabs"]> = [];
for (let i = 1; i <= 60; i++) {
  tabs.push({
    ...base,
    id: i,
    index: i - 1,
    active: i === 1,
    url: `https://site${i}.example.com/`,
    title: `Tab ${i}`,
    lastAccessed: NOW - i * 1000,
    // 30..34: a tab group; 36 + 37: a split pair
    groupId: i >= 30 && i <= 34 ? 7 : -1,
    ...(i === 36 || i === 37 ? { splitViewId: 5 } : {}),
  });
}
// comfortable density (the meta line shows), tag pills and a protected badge on some rows:
// the rows whose height could differ from the measured placeholder
const fixture: Fixture = {
  tabs,
  groups: [{ id: 7, title: "work", color: "blue", collapsed: false, windowId: 1 }],
  stored: {
    ui: { sort: "window", density: "comfortable" },
    protectionRules: [{ id: "r1", type: "host", pattern: "site33.example.com", createdAt: 1 }],
    tags: [
      { id: "t1", name: "taboom links", color: "purple" },
      { id: "t2", name: "work", color: "blue" },
    ],
    tagPages: [
      { url: "https://site31.example.com/", tagIds: ["t1"] },
      { url: "https://site36.example.com/", tagIds: ["t1", "t2"] },
      { url: "https://site10.example.com/", tagIds: ["t2"] },
    ],
  },
};
const panel = await mountSidePanel(fixture);
const list = () => document.getElementById("tab-list") as HTMLElement;
list().style.maxHeight = "420px"; // a short viewport so the blocks below start off-screen (the 5-row group still fits)
const rowOf = (id: number) => document.querySelector(`.row[data-tab-id="${id}"]`) as HTMLElement;

function visible(el: Element): boolean {
  const box = el.getBoundingClientRect();
  const view = list().getBoundingClientRect();
  return box.top >= view.top - 1 && box.bottom <= view.bottom + 1;
}

// the mount clones the fixture: flip `active` on the mock's live list (query() hands it out by reference)
const live = await panel.chrome.tabs.query({});
async function activate(id: number) {
  for (const tab of live) {
    tab.active = tab.id === id;
  }
  await panel.chrome.tabs.onActivated.fire({ tabId: id, windowId: 1 });
  await settle(500); // 150 ms debounce + render
}

const margin = () => Number.parseFloat(window.getComputedStyle(rowOf(20)).scrollMarginTop) || 0;
const atTop = (el: HTMLElement) =>
  Math.abs(el.getBoundingClientRect().top - margin() - list().getBoundingClientRect().top);

test("activating the second half of a split: the Split header lands at the top, both rows under it", async () => {
  await activate(37);
  const header = document.querySelector(".split-header") as HTMLElement;
  expect(atTop(header)).toBeLessThan(2);
  expect(visible(rowOf(36))).toBe(true);
  expect(visible(rowOf(37))).toBe(true);
});

test("the same from below: scrolled past the split, activating it brings the header back to the top", async () => {
  await activate(2);
  list().scrollTop = list().scrollHeight;
  await activate(36);
  expect(atTop(document.querySelector(".split-header") as HTMLElement)).toBeLessThan(2);
});

test("activating a tab in a group: the group's sub-header at the top, every row of it visible", async () => {
  await activate(2);
  list().scrollTop = 0;
  await activate(33);
  const header = [...document.querySelectorAll(".tabgroup-header:not(.split-header)")].find((el) =>
    (el.textContent ?? "").includes("work"),
  ) as HTMLElement;
  expect(atTop(header)).toBeLessThan(2);
  for (const id of [30, 31, 32, 33, 34]) {
    expect(visible(rowOf(id)), `row ${id}`).toBe(true);
  }
});

test("a plain row lands at the top (under the sticky window header)", async () => {
  list().scrollTop = 0;
  await activate(20);
  expect(atTop(rowOf(20))).toBeLessThan(2);
});

test("near the end of the list the top is out of reach: the scroll stops at its maximum", async () => {
  list().scrollTop = 0;
  await activate(59);
  expect(visible(rowOf(59))).toBe(true);
  expect(Math.abs(list().scrollTop - (list().scrollHeight - list().clientHeight))).toBeLessThan(2);
});

test("every row has the placeholder's height: pills and badges never make a row taller", async () => {
  // off-screen rows are content-visibility placeholders sized from one measured row (--row-h);
  // a row that renders taller shifts the list by the difference on every re-render
  const rowH = Number.parseFloat(list().style.getPropertyValue("--row-h"));
  expect(rowH).toBeGreaterThan(0);
  for (const row of document.querySelectorAll<HTMLElement>(".row")) {
    row.style.contentVisibility = "visible";
    const cs = window.getComputedStyle(row);
    const content =
      row.getBoundingClientRect().height -
      Number.parseFloat(cs.paddingTop) -
      Number.parseFloat(cs.paddingBottom) -
      Number.parseFloat(cs.borderTopWidth) -
      Number.parseFloat(cs.borderBottomWidth);
    expect(Math.abs(content - rowH), `row ${row.dataset.tabId}`).toBeLessThan(0.05);
    row.style.contentVisibility = "";
  }
});

// view changes (filter / scope / sort): the current item goes to the TOP of the list, its
// Split or group header above it — not the minimal scroll a tab switch gets
const filterTo = async (name: string) => {
  (document.querySelector(`#filters button[data-filter="${name}"]`) as HTMLElement).click();
  await settle(300);
};
test("filter switch: a plain current row lands at the top (under the sticky window header)", async () => {
  await activate(20);
  await filterTo("awake");
  list().scrollTop = 0;
  await filterTo("all");
  const view = list().getBoundingClientRect();
  expect(Math.abs(rowOf(20).getBoundingClientRect().top - margin() - view.top)).toBeLessThan(2);
});

test("filter switch: a current row in a group lands with the group's header at the top", async () => {
  await activate(33);
  await filterTo("awake");
  list().scrollTop = 0;
  await filterTo("all");
  const view = list().getBoundingClientRect();
  const header = [...document.querySelectorAll(".tabgroup-header:not(.split-header)")].find((el) =>
    (el.textContent ?? "").includes("work"),
  ) as HTMLElement;
  expect(Math.abs(header.getBoundingClientRect().top - margin() - view.top)).toBeLessThan(2);
  expect(visible(rowOf(33))).toBe(true);
});
