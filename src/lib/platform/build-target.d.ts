// The browser a BUILD is for, as constants Vite defines (vite.config.ts `define`, from TARGET) and
// Rollup folds: a `__CHROME__ && …` branch is cut out of the Firefox bundle and vice versa, so a
// store validator never reads code the other browser would run. Run-time feature detection stays
// (capabilities.ts); these only remove what a target can never need. The test projects define
// both as true (vitest.config.ts) — there the mock decides, as a browser would.
declare const __CHROME__: boolean;
declare const __FIREFOX__: boolean;
