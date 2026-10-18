// The search highlight is an inline <mark> styled as bold colored text: a selector merged into
// a neighbouring rule once turned it into a yellow flex block that wrapped the title.
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { DEFAULT_FIXTURE, mountSidePanel, settle } from "./mount.ts";

await mountSidePanel(DEFAULT_FIXTURE);

test("a search hit in a title is an inline bold mark without the browser's yellow", async () => {
  await userEvent.click(document.getElementById("search") as HTMLElement);
  await userEvent.keyboard("pull");
  await settle();
  const mark = document.querySelector('.row[data-tab-id="1"] .title mark') as HTMLElement;
  expect(mark).not.toBeNull();
  const style = getComputedStyle(mark);
  expect(style.display).toBe("inline");
  expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(Number(style.fontWeight)).toBeGreaterThanOrEqual(700);
  const title = mark.closest(".title") as HTMLElement;
  expect(title.getBoundingClientRect().height).toBeLessThan(30); // one line
  await userEvent.keyboard("{Escape}");
});
