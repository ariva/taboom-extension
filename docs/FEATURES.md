# Taboom - Tabs Manager - Features

A picture per feature, in the order the [demo](assets/demo/taboom-demo.mp4) shows them. The
long version of each is in [Usage](USAGE.md); the images are the demo's own stills
(`docs/assets/features/`, retaken on every `just build`), so they always match the shipped
version.

## The side panel

One panel for every window and tab: each window is a group with its name and color, the
active tab of each window is marked, snoozed tabs are dimmed. Hover a row for its full
address, its states and its tags.

<p>
  <img src="assets/features/panel-overview.png" alt="Side panel - all windows, grouped by window" width="360">
  <img src="assets/features/row-hover-tip.png" alt="Side panel - row hover tip with address, states and tags" width="360">
</p>

→ [Usage: Side panel](USAGE.md#side-panel-main-ui)

## Search and filters

Search matches titles, addresses and tag names; several words must all match. A `#word`
token searches tags only. The Awake / Snoozed / Protected chips carry live counts, and the
Tags chip opens a picker to show only tabs carrying one of the ticked tags.

<p>
  <img src="assets/features/search-words.png" alt="Search - several words" width="360">
  <img src="assets/features/search-tag.png" alt="Search - #tag token" width="360">
</p>
<p>
  <img src="assets/features/filters-protected.png" alt="Filters - Protected chip" width="360">
  <img src="assets/features/filters-tags-picker.png" alt="Filters - Tags picker" width="360">
</p>

→ [Usage: Side panel](USAGE.md#side-panel-main-ui) · [Usage: Tags](USAGE.md#tags)

## Tags

Colored labels on a page address: tick as many as you like in the row's **Tags…** checklist,
see them as pills on every tab of that page and in the hover tip, group the list by tag.

<p>
  <img src="assets/features/tags-assign-popover.png" alt="Tags - the Tags… checklist" width="360">
  <img src="assets/features/tags-row-pills.png" alt="Tags - pills on a row" width="360">
</p>
<p>
  <img src="assets/features/tags-group-by-tag.png" alt="Tags - group by tag" width="360">
</p>

→ [Usage: Tags](USAGE.md#tags)

## Windows and parking

The quick launch (▦) lists every window with its counts; a window's ⋯ menu renames it and
gives it a color. A tab's menu moves it to another window, and with several rows ticked the
bottom bar and the menu act on all of them. Park a window you do not need right now: its
tabs wait closed in the **Parked windows** scope until you restore it.

<p>
  <img src="assets/features/quick-launch-windows.png" alt="Quick launch - Windows view" width="360">
  <img src="assets/features/window-color-menu.png" alt="Window menu - color" width="360">
</p>
<p>
  <img src="assets/features/move-tab-menu.png" alt="Row menu - Move tab to another window" width="360">
  <img src="assets/features/bulk-bar-selection.png" alt="Selection - bulk bar" width="360">
</p>
<p>
  <img src="assets/features/parked-scope.png" alt="Parked windows scope" width="360">
</p>

→ [Usage: Parked windows](USAGE.md#parked-windows)

## Grouping and sorting

Group by window is the default; group by domain, title, Chrome tab group or tag, fold them
all with one click, or use a flat list, most recently used first.

<p>
  <img src="assets/features/group-by-domain.png" alt="Group by domain" width="360">
  <img src="assets/features/group-by-tabgroup.png" alt="Group by tab group" width="360">
</p>
<p>
  <img src="assets/features/sort-recent.png" alt="Flat list, most recent first" width="360">
</p>

## Actions and duplicates

Hover a row for snooze, protect and close; tick rows for bulk Snooze / Wake / Protect / Close
from the bottom bar. The quick launch's **Dupes** view lists every page open more than once,
and the ☰ menu's **Cleanup Duplicates** keeps one copy of each.

<p>
  <img src="assets/features/row-actions-hover.png" alt="Row hover actions" width="360">
  <img src="assets/features/bulk-snooze-selection.png" alt="Bulk snooze of a selection" width="360">
</p>
<p>
  <img src="assets/features/quick-launch-dupes.png" alt="Quick launch - Dupes view" width="360">
  <img src="assets/features/quick-actions-menu.png" alt="Quick actions menu" width="360">
</p>

**Snooze inactive tabs now** — the ☰ menu (and the same button in Settings → Automatic Snooze)
runs the automatic-snooze check right away: every tab the rules allow goes, the inactivity
threshold does not apply, and a toast says how many.

<p>
  <img src="assets/features/quick-actions-snooze-now.png" alt="Quick actions - Snooze inactive tabs now" width="360">
  <img src="assets/features/snooze-now-toast.png" alt="Snooze now - the count toast" width="360">
</p>

→ [Usage: Duplicates](USAGE.md#duplicates)

## Settings

Zoom, density and theme (the panel follows at once), automatic snooze thresholds and
exclusions, protected sites, keep-alive marks that reload a page on a timer, and the tags
tables. Every table edits in place; removals can be undone.

<p>
  <img src="assets/features/settings-interface-dark.png" alt="Settings - Interface, dark theme" width="460">
  <img src="assets/features/panel-dark-theme.png" alt="Side panel - dark theme" width="300">
</p>
<p>
  <img src="assets/features/settings-auto-snooze.png" alt="Settings - Automatic snooze" width="460">
  <img src="assets/features/settings-snooze-now.png" alt="Settings - Snooze inactive tabs now" width="460">
</p>
<p>
  <img src="assets/features/settings-protected-sites.png" alt="Settings - Protected sites" width="460">
</p>
<p>
  <img src="assets/features/settings-keep-alive.png" alt="Settings - Keep tabs alive" width="460">
  <img src="assets/features/settings-tags.png" alt="Settings - Tags" width="460">
</p>

→ [Usage: Automatic snooze](USAGE.md#automatic-snooze) · [Protecting sites](USAGE.md#protecting-sites) · [Keeping tabs alive](USAGE.md#keeping-tabs-alive) · [Tags](USAGE.md#tags)
