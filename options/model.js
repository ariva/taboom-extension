// Pure view logic for the options page - easier to test.

export const FONT_SIZE_MIN = 0.6;
export const FONT_SIZE_MAX = 1.5;

export function clampFontSize(value) {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Number(value) || 1));
}

// numeric setting inputs clamp to their floor; empty/garbage falls back to floor
export function clampedNumber(value, floor) {
  return Math.max(floor, Number(value) || floor);
}

export function hasRule(rules, pattern) {
  return rules.some((rule) => rule.pattern === pattern);
}

export function aboutText(version) {
  return `Taboom ${version}`;
}

// How many release sections the options "What's new" box shows.
export const SHOW_MAX_CHANGES = 25;

// Newest `count` release sections of CHANGES.md as [{ title, body }], newest first.
export function releaseSections(markdown, count = SHOW_MAX_CHANGES) {
  return markdown
    .split(/^## /m)
    .slice(1, count + 1)
    .map((section) => {
      const [title, ...body] = section.split("\n");
      return { title: title.trim(), body: body.join("\n").trim() };
    });
}

// Section of CHANGES.md for `version`, falling back to the newest section.
// Returns { title, body } or null when the markdown has no "## " sections.
export function releaseNotes(markdown, version) {
  const sections = markdown.split(/^## /m).slice(1);
  if (sections.length === 0) return null;
  const match = sections.find((s) => s.startsWith(`v${version} `) || s.startsWith(`v${version}\n`));
  const [title, ...body] = (match ?? sections[0]).split("\n");
  return { title: title.trim(), body: body.join("\n").trim() };
}
