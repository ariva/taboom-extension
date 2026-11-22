import type { Scene } from "./index.ts";

// the row menu without the mouse: arrows put the amber cursor on a row, Shift+F10 (the Menu key,
// or "." outside the search) opens its menu with the first item focused, arrows walk it, Right
// enters a submenu, Left leaves it, Esc closes and hands the focus back to the search
export const keyboardMenu: Scene = {
  id: "keyboard-menu",
  title: "Row menus from the keyboard",
  feature: "Row menus from the keyboard",
  settings: "#page-title",
  newIn: "1.1.0",
  covers: /cursor row's menu|Shift\+F10/i,
  async run(stage) {
    await stage.caption(`${stage.release} — every row action without the mouse`, 1800);
    await stage.click(stage.panel.locator("#search"));
    await stage.caption("↓ and ↑ move the amber cursor over the list", 600);
    await stage.press("ArrowDown");
    await stage.press("ArrowDown");
    await stage.press("ArrowDown");
    await stage.pause(600);
    await stage.caption("Shift+F10 or the Menu key opens that row's menu — so does . outside the search", 800);
    await stage.press("Shift+F10");
    await stage.pause(700);
    const menuOpen = await stage.panel.evaluate(() => document.getElementById("ctx-menu")?.hidden === false);
    stage.check(menuOpen, "keyboard-menu: Shift+F10 opened no menu");
    await stage.still("keyboard-row-menu");
    await stage.caption("↓ and ↑ walk the items; Enter runs the one in focus", 600);
    // down to the first submenu toggle (Protect, Keep alive or Move to — whatever the row offers)
    for (let step = 0; step < 20; step++) {
      const onToggle = await stage.panel.evaluate(() => document.activeElement?.matches(".ctx-move") === true);
      if (onToggle) {
        break;
      }
      await stage.press("ArrowDown");
    }
    await stage.caption("→ enters a submenu, ← leaves it", 600);
    await stage.press("ArrowRight");
    await stage.pause(500);
    const inSubmenu = await stage.panel.evaluate(
      () => document.activeElement?.matches(".ctx-submenu .ctx-item") === true,
    );
    stage.check(inSubmenu, "keyboard-menu: → did not enter a submenu");
    await stage.press("ArrowDown");
    await stage.still("keyboard-row-submenu");
    await stage.press("ArrowLeft");
    await stage.caption("Esc closes the menu — the focus is back in the search, the cursor where it was", 600);
    await stage.press("Escape");
    await stage.pause(900);
    // a second Esc clears the (empty) search, and the cursor with it: the next scene starts clean
    await stage.press("Escape");
    await stage.caption("", 300);
  },
};
