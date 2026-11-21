import type { Scene } from "./index.ts";

// drag reorder of the Settings tables (T-0154): the Settings pane has no cursor, so the drag is
// the row-reorder's own events dispatched on the real rows — dragstart + dragover hold the
// highlight on screen, drop + dragend let the writer move the row
export interface DragArgs {
  rows: string; // tbody id
  from: string; // data-key of the dragged row
  to: string; // data-key of the row it lands on
  step: "over" | "drop";
}
export function dragRows(args: DragArgs): boolean {
  const table = document.getElementById(args.rows);
  const find = (key: string) => table?.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(key)}"]`) ?? null;
  const dragged = find(args.from);
  const target = find(args.to);
  if (!dragged || !target) {
    return false;
  }
  const fire = (element: HTMLElement, type: string) =>
    element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true }));
  if (args.step === "over") {
    fire(dragged, "dragstart");
    fire(target, "dragover");
  } else {
    fire(target, "drop");
    fire(dragged, "dragend");
  }
  return true;
}

export const settingsReorder: Scene = {
  id: "settings-reorder",
  settings: "#keep-alive-table",
  title: "Reorder keep-alive marks and tagged page rules",
  newIn: "1.1.0",
  covers: /reorder/i,
  async run(stage) {
    const settings = stage.aside.settings;
    const keysOf = (rows: string) =>
      settings.evaluate(
        (id) =>
          Array.from(document.querySelectorAll<HTMLElement>(`#${id} tr[data-key]`)).map((row) => row.dataset.key ?? ""),
        rows,
      );
    // the last row onto the first: it lands before it (dragged up)
    // the still is a literal call per table: tests/demo/stills.test.ts reads the names from the source
    const drag = async (rows: string, still: () => Promise<void>) => {
      await settings.locator(`#${rows}`).evaluate((element) => element.scrollIntoView({ block: "center" }));
      await stage.pause(900);
      const keys = await keysOf(rows);
      const from = keys[keys.length - 1] ?? "";
      const to = keys[0] ?? "";
      stage.check(keys.length >= 2 && from !== to, `${rows}: fewer than two rows to reorder`);
      await settings.evaluate(dragRows, { rows, from, to, step: "over" } satisfies DragArgs);
      await stage.pause(1200);
      await still();
      await settings.evaluate(dragRows, { rows, from, to, step: "drop" } satisfies DragArgs);
      await stage.pause(1200);
      stage.check((await keysOf(rows))[0] === from, `${rows}: the dragged row did not land first`);
    };
    await stage.caption(`${stage.release} — drag a row by its grip to reorder the keep-alive marks…`, 1800);
    await drag("keep-alive-rows", () => stage.still("settings-reorder-keep-alive", "settings"));
    await stage.caption("The order is the Alive view's and the catch-up reloads' order", 1400);
    await stage.caption("…and the tagged page rules the same way", 1000);
    await stage.settings("#tag-page-table");
    await drag("tag-page-rows", () => stage.still("settings-reorder-tag-pages", "settings"));
    await stage.caption("Dragged down lands after the target, up lands before it", 1400);
    await stage.caption("", 300);
  },
};
