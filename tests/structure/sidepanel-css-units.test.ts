// The side panel zooms through the root font-size (ui.fontSize, rem). Anything
// sized in px — icons, checkboxes, popover text — ignores that zoom, which is
// exactly the bug this guards against. Hairlines and the pill radius stay px on purpose.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ALLOWED_PX = new Set(["1px", "0.4px", "9999px"]);

test("Structure - sidepanel.css sizes in rem so ui.fontSize zooms everything", () => {
  const css = readFileSync(resolve(ROOT, "src/pages/sidepanel/sidepanel.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const offenders = css
    .split("\n")
    .flatMap((line, index) =>
      [...line.matchAll(/-?[\d.]+px/g)]
        .filter((m) => !ALLOWED_PX.has(m[0].replace("-", "")))
        .map((m) => `${index + 1}: ${m[0]}`),
    );
  assert.deepEqual(offenders, [], "px sizes do not follow the zoom setting — use rem (value / 16)");
});
