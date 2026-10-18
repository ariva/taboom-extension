// Tag pills on a row: as many as the meta line holds, then "+N" — the count comes from measured
// widths (render/meta-fit.ts), so only a real browser can judge it.
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DEFAULT_FIXTURE, mountSidePanel, settle } from "./mount.ts";

const tags = [
  { id: "t1", name: "Backend infra", color: "blue" },
  { id: "t2", name: "Customer notes", color: "green" },
  { id: "t3", name: "Quarterly docs", color: "red" },
  { id: "s1", name: "a", color: "blue" },
  { id: "s2", name: "b", color: "green" },
  { id: "s3", name: "c", color: "red" },
  { id: "s4", name: "d", color: "cyan" },
  { id: "s5", name: "e", color: "pink" },
  { id: "l1", name: "very long tag to be used", color: "pink" },
  { id: "l2", name: "x", color: "blue" },
];
await mountSidePanel({
  ...DEFAULT_FIXTURE,
  stored: {
    ui: { showExperimental: true },
    tags,
    tagPages: [
      { url: "https://github.com/pr/1", tagIds: ["t1", "t2", "t3"] },
      { url: "https://youtube.com/watch", tagIds: ["s1", "s2", "s3", "s4", "s5"] },
      { url: "https://mail.google.com/inbox", tagIds: ["l1", "l2"] },
    ],
  },
});

const row = (id: number) => document.querySelector(`.row[data-tab-id="${id}"]`) as HTMLElement;
const pills = (id: number) => [...row(id).querySelectorAll<HTMLElement>(".badge.tag")];
const more = (id: number) => row(id).querySelector(".badge.tag-more")?.textContent ?? null;
const oneLine = (id: number) => {
  const host = row(id).querySelector(".host") as HTMLElement;
  // centered items of 17 / 18 px differ by a pixel; a second line would be 18+ px lower
  return [...row(id).querySelectorAll<HTMLElement>(".meta > *")].every(
    (item) => Math.abs(item.offsetTop - host.offsetTop) <= 2,
  );
};
const noEllipsis = (pill: HTMLElement) => {
  const text = pill.firstElementChild as HTMLElement;
  return text.scrollWidth <= text.clientWidth;
};

test("long tags: the pills that fit stay whole on one line, the rest fold into +N", () => {
  expect(pills(1).length).toBeLessThan(3);
  expect(pills(1).length).toBeGreaterThan(0);
  expect(more(1)).toBe(`+${3 - pills(1).length}`);
  expect(pills(1).every(noEllipsis)).toBe(true);
  expect(oneLine(1)).toBe(true);
  expect((row(1).querySelector(".host") as HTMLElement).offsetWidth > 40).toBe(true); // the host keeps its room
  expect(row(1).offsetHeight).toBe(row(2).offsetHeight); // no second line
});

test("a pill too long for the line beside the pinned badge is cut short: the +N and the host stay visible", () => {
  expect(pills(3).length).toBe(1);
  expect(more(3)).toBe("+1");
  const meta = row(3).querySelector(".meta") as HTMLElement;
  const moreBadge = row(3).querySelector(".badge.tag-more") as HTMLElement;
  expect(moreBadge.getBoundingClientRect().right <= meta.getBoundingClientRect().right).toBe(true);
  const pill = pills(3)[0] as HTMLElement;
  expect(noEllipsis(pill)).toBe(false);
  expect((row(3).querySelector(".host") as HTMLElement).offsetWidth >= 90).toBe(true); // the 6rem floor
  expect(oneLine(3)).toBe(true);
});

test("five short tags all show when the panel is wide enough, no +N; a narrower panel folds some", async () => {
  await page.viewport(700, 896);
  await settle();
  expect(pills(2).map((pill) => pill.textContent)).toEqual(["a", "b", "c", "d", "e"]);
  expect(more(2)).toBeNull();
  expect(oneLine(2)).toBe(true);
  await page.viewport(300, 896);
  await settle();
  expect(pills(2).length).toBeLessThan(5);
  expect(pills(2).length).toBeGreaterThan(0);
  expect(more(2)).toBe(`+${5 - pills(2).length}`);
  expect(oneLine(2)).toBe(true);
  expect(pills(2).every(noEllipsis)).toBe(true);
  await page.viewport(700, 896);
  await settle();
  expect(more(2)).toBeNull();
  await page.viewport(414, 896);
  await settle();
});

test("the hover tip's Tags line shows every name whole: the row cap does not apply there", async () => {
  await userEvent.hover(row(3));
  await settle();
  const tip = document.getElementById("hover-tip") as HTMLElement;
  expect(tip.hidden).toBe(false);
  const tipPills = [...tip.querySelectorAll<HTMLElement>(".tip-tags .badge.tag")];
  expect(tipPills.map((pill) => pill.textContent)).toEqual(["very long tag to be used", "x"]);
  expect(tipPills.every(noEllipsis)).toBe(true);
  await userEvent.unhover(row(3));
});
