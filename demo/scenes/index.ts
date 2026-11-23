// The scene registry: recording order, the "new in this release" marks and the GIF clips.
// A scene is a function over the Stage; the recorder films it, encode.sh cuts the films.
import type { Stage } from "../stage.ts";
import { duplicates, snoozeProtect } from "./actions.ts";
import { grouping } from "./grouping.ts";
import { keepAliveDomain } from "./keep-alive.ts";
import { keyboardMenu } from "./keyboard-menu.ts";
import { keyboardSelect } from "./keyboard-select.ts";
import { settingsReorder } from "./reorder.ts";
import { tabNames } from "./tab-names.ts";
import { tagFragment } from "./tag-fragment.ts";
import { temporaryProtection } from "./temporary.ts";
import { filters, search } from "./search.ts";
import { settings } from "./settings.ts";
import { settingsTabs } from "./settings-tabs.ts";
import { sharedView } from "./shared-view.ts";
import { snoozeNow } from "./snooze-now.ts";
import { tags } from "./tags.ts";
import { tour } from "./tour.ts";
import { outro } from "./outro.ts";
import { readme } from "./readme.ts";
import { moveTab, parked, windows } from "./windows.ts";

export interface Scene {
  id: string;
  title: string;
  feature?: string; // its line in the feature checklist; scenes naming the same line share it (ticked after the last)
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
  tabNames,
  temporaryProtection,
  keepAliveDomain,
  settingsReorder,
  tagFragment,
  keyboardMenu,
  keyboardSelect,
  settingsTabs,
  sharedView,
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

// how a scene names its release: "New in 1.1.0" while that is the release being recorded,
// "Since 1.0.5" once it is older (a caption saying "new" about a two-release-old feature reads
// stale), nothing for a scene of no particular release. Scenes read it as `stage.release`
export function releaseMark(newIn: string | undefined, version: string): string {
  if (!newIn) {
    return "";
  }
  return newIn === version ? `New in ${newIn}` : `Since ${newIn}`;
}

// the story pane's heading: the release mark before the title
export function sceneHeading(scene: Pick<Scene, "title" | "newIn">, version: string): string {
  const mark = releaseMark(scene.newIn, version);
  return mark ? `${mark} · ${scene.title}` : scene.title;
}

// ---------- the feature checklist ----------
// The list of what the film shows, held on the story pane before every scene: the whole list at
// the film's start, then the same list between scenes with the finished lines ticked — so a
// viewer can tell what was shown and what is still to come. Five seconds each time, the opening
// included: longer and the film drags (a viewer can pause).
export const CHECKLIST_MS = 5_000;

export interface ChecklistItem {
  label: string;
  state: "done" | "now" | "todo";
}
export interface Checklist {
  groups: { heading: string; items: ChecklistItem[] }[];
  done: number;
  total: number;
}

// the list as it stands right before `sceneId` plays: a line is done when every scene naming it
// has played, "now" when the coming scene is one of them (or one of them already played)
export function checklist(version: string, sceneId: string, scenes: Scene[] = SCENES): Checklist {
  const ordered = orderedForRelease(version, scenes);
  const current = ordered.findIndex((scene) => scene.id === sceneId);
  const labels = [...new Set(ordered.map((scene) => scene.feature).filter((label) => label !== undefined))];
  const items = labels.map((label) => {
    const at = ordered.flatMap((scene, index) => (scene.feature === label ? [index] : []));
    const played = at.filter((index) => index < current).length;
    const underWay = played > 0 || at.includes(current);
    const state: ChecklistItem["state"] = played === at.length ? "done" : underWay ? "now" : "todo";
    const fresh = ordered[at[0] ?? -1]?.newIn === version;
    return { label, state, fresh };
  });
  const strip = (list: typeof items): ChecklistItem[] => list.map(({ label, state }) => ({ label, state }));
  const fresh = items.filter((item) => item.fresh);
  const rest = items.filter((item) => !item.fresh);
  const groups =
    fresh.length > 0
      ? [
          { heading: `New in ${version}`, items: strip(fresh) },
          { heading: "Everything else", items: strip(rest) },
        ]
      : [{ heading: "Features", items: strip(rest) }];
  return {
    groups: groups.filter((group) => group.items.length > 0),
    done: items.filter((item) => item.state === "done").length,
    total: items.length,
  };
}

// a scene's GIF clip is given from the scene's own start; the take begins with the checklist,
// `leadMs` long (absent on a take from before the checklist existed)
export function shiftedGif(gif: [number, number], leadMs: number | undefined): [number, number] {
  const lead = leadMs ?? 0;
  return [(gif[0] * 1000 + lead) / 1000, (gif[1] * 1000 + lead) / 1000]; // in ms, then back: no float tails in scenes.json
}
