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
