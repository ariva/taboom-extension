// node:assert builds a failed comparison's message by inspecting both values to depth 1000,
// getters included. A happy-dom node reaches its whole document and window that way: the
// inspection never ends and allocates off-heap at over 1 GB/s (V8's heap limit does not stop
// it), so the test never reports "failed" — the worker grows until the machine is out of memory.
// A node is therefore never handed to an equality assert: compare inside assert.ok
// (`assert.ok(node === null, "...")`), whose failure prints nothing but the message.
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const EQUALITY_ASSERT = /assert\.(?:not)?(?:deep)?(?:strict)?equal\(/gi;
// an argument that ENDS in one of these is a node (or null); `.textContent` etc. after it is fine
const NODE_EXPRESSION =
  /(?:\b(?:querySelector|closest|getElementById|q|byId)\((?:[^()]|\([^()]*\))*\)|\b(?:activeElement|nextElementSibling|previousElementSibling|firstElementChild|lastElementChild|parentElement))$/;

// the top-level arguments of the call whose opening parenthesis sits just before `start`
// ponytail: quotes and brackets only, no regex-literal or comment awareness — enough for assert calls
function callArguments(source: string, start: number): string[] {
  const found: string[] = [];
  let depth = 0;
  let quote = "";
  let from = start;
  for (let at = start; at < source.length; at++) {
    const char = source.charAt(at);
    if (quote) {
      if (char === "\\") {
        at++;
      } else if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if ("([{".includes(char)) {
      depth++;
    } else if (")]}".includes(char)) {
      if (depth === 0) {
        found.push(source.slice(from, at).trim());
        return found;
      }
      depth--;
    } else if (char === "," && depth === 0) {
      found.push(source.slice(from, at).trim());
      from = at + 1;
    }
  }
  return found;
}

function nodeArguments(source: string): string[] {
  return [...source.matchAll(EQUALITY_ASSERT)].flatMap((match) => {
    const start = match.index + match[0].length;
    const line = source.slice(0, start).split("\n").length;
    return callArguments(source, start)
      .slice(0, 2) // actual, expected — the third is the message
      .filter((argument) => NODE_EXPRESSION.test(argument))
      .map((argument) => `${line}: ${argument}`);
  });
}

test("Structure - the node detector reads call arguments, not substrings", () => {
  const node = 'assert.equal(row.querySelector(".a, .b"), null, "gone");';
  assert.deepEqual(nodeArguments(node), ['1: row.querySelector(".a, .b")']);
  assert.deepEqual(nodeArguments("assert.notEqual(first, document.activeElement);"), ["1: document.activeElement"]);
  assert.deepEqual(nodeArguments('assert.equal(q(chip(), "span"), other);'), ['1: q(chip(), "span")']);
  assert.deepEqual(nodeArguments('assert.equal(q(row, "span").textContent, "x");'), []);
  assert.deepEqual(nodeArguments('assert.equal(row.querySelector("a")?.title, "x");'), []);
  assert.deepEqual(nodeArguments('assert.equal(must(row.querySelector("a")).title, "x");'), []);
  assert.deepEqual(nodeArguments('assert.ok(row.querySelector("a") === null, "x");'), []);
});

test("Structure - no DOM node is handed to an equality assert (a failure would never finish printing it)", () => {
  const offenders = globSync("tests/**/*.test.ts", {
    cwd: ROOT,
    exclude: ["tests/structure/assert-dom-nodes.test.ts"],
  }).flatMap((file) => nodeArguments(readFileSync(resolve(ROOT, file), "utf8")).map((found) => `${file}:${found}`));
  assert.deepEqual(offenders, [], "compare nodes inside assert.ok(a === b, message) instead");
});
