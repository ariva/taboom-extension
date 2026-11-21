// The playing-audio icon follows the host on the meta line: only a real layout can say that it
// sits right after the text, stays in view when a long host ellipsizes, is centred on the line and
// leaves the row as tall as a silent one (every row equal — the content-visibility placeholders are
// sized from one measured row).
import { expect, test } from "vitest";
import { DEFAULT_FIXTURE, mountSidePanel } from "./mount.ts";

const fixture = structuredClone(DEFAULT_FIXTURE);
for (const tab of fixture.tabs ?? []) {
  if (tab.id === 1) {
    tab.audible = true;
  }
  if (tab.id === 3) {
    tab.audible = true;
    tab.url = "https://a-very-long-subdomain.another-long-part.example-corporation-intranet.test/mail";
  }
}
await mountSidePanel(fixture);

const rect = (selector: string) => (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
const middle = (box: DOMRect) => box.top + box.height / 2;

test("the 🔊 sits right after a short host, centred on the meta line; the row height is unchanged", () => {
  const audio = rect('.row[data-tab-id="1"] .host .audio');
  const text = rect('.row[data-tab-id="1"] .host-text');
  const meta = rect('.row[data-tab-id="1"] .meta');
  // the box is lifted 0.0625rem (the emoji's ink sits low in it): its middle a pixel above the line's
  const lift = middle(meta) - middle(audio);
  expect(lift).toBeGreaterThanOrEqual(0);
  expect(lift).toBeLessThanOrEqual(1.5);
  expect(audio.left - text.right).toBeGreaterThanOrEqual(0);
  expect(audio.left - text.right).toBeLessThan(8);
  expect(rect('.row[data-tab-id="1"]').height).toBeCloseTo(rect('.row[data-tab-id="2"]').height, 1); // Gecko: 1e-5 rounding
  expect(document.querySelector('.row[data-tab-id="2"] .audio')).toBeNull();
});

test("a long host ellipsizes and the 🔊 stays in view inside the row", () => {
  const text = document.querySelector('.row[data-tab-id="3"] .host-text') as HTMLElement;
  expect(text.scrollWidth).toBeGreaterThan(text.clientWidth); // cut short, the ellipsis shows
  const audio = rect('.row[data-tab-id="3"] .host .audio');
  const row = rect('.row[data-tab-id="3"]');
  expect(audio.width).toBeGreaterThan(0);
  expect(audio.right).toBeLessThanOrEqual(row.right);
  expect(audio.left).toBeGreaterThanOrEqual(rect('.row[data-tab-id="3"] .host-text').right);
  expect(row.height).toBeCloseTo(rect('.row[data-tab-id="2"]').height, 1);
});
