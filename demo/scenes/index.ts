// The scene registry: recording order, the "new in this release" marks and the GIF clips.
// A scene is a function over the Stage; the recorder films it, encode.sh cuts the films.
import type { Stage } from "../stage.ts";
import { duplicates, snoozeProtect } from "./actions.ts";
import { grouping } from "./grouping.ts";
import { filters, search } from "./search.ts";
import { settings } from "./settings.ts";
import { snoozeNow } from "./snooze-now.ts";
import { tags } from "./tags.ts";
import { tour } from "./tour.ts";
import { outro } from "./outro.ts";
import { readme } from "./readme.ts";
import { moveTab, parked, windows } from "./windows.ts";

export interface Scene {
  id: string;
  title: string;
  settings: string; // an #id of options/index.html: the Settings pane scrolls to its card when the scene starts
  newIn?: string; // the release this scene demonstrates something new of (CHANGES.md version)
  covers?: RegExp; // which "### New Features" bullets of the current CHANGES.md entry it shows (new scene or not)
  gif?: [fromSec: number, toSec: number]; // the clip that goes into the short GIF
  stillsOnly?: true; // not filmed, no row in scenes.json: the scene only takes stills
  run: (stage: Stage) => Promise<void>;
}

// the "new in this release" scenes play first, then the tour of everything else; the outro
// (no newIn, ever) stays last through the reordering
export const SCENES: Scene[] = [
  snoozeNow,
  tags,
  parked,
  tour,
  search,
  filters,
  windows,
  grouping,
  moveTab,
  snoozeProtect,
  duplicates,
  settings,
  readme,
  outro,
];

export const GIF_MAX_SECONDS = 30;

export function orderedForRelease(version: string, scenes: Scene[] = SCENES): Scene[] {
  const fresh = scenes.filter((scene) => scene.newIn === version);
  return [...fresh, ...scenes.filter((scene) => scene.newIn !== version)];
}
