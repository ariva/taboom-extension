# Taboom - Tabs Manager - Features

A picture per feature, in the order the [demo](assets/demo/chrome/taboom-demo.mp4) shows them. The
long version of each is in [Usage](USAGE.md); the images are the demo's own stills
(`docs/assets/features/chrome/`, retaken on every `just build`), so they always match the shipped
version.

## The side panel

One panel for every window and tab: each window is a group with its name and color, the
active tab of each window is marked, snoozed tabs are dimmed. Hover a row for its full
address, its states and its tags.

<p>
  <img src="assets/features/chrome/panel-overview.png" alt="Side panel - all windows, grouped by window" width="360">
  <img src="assets/features/chrome/row-hover-tip.png" alt="Side panel - row hover tip with address, states and tags" width="360">
</p>

→ [Usage: Side panel](USAGE.md#side-panel-main-ui)

## Search and filters

Search matches titles, addresses and tag names; several words must all match. A `#word`
token searches tags only. The Awake / Snoozed / Protected chips carry live counts, and the
Tags chip opens a picker to show only tabs carrying one of the ticked tags.

<p>
  <img src="assets/features/chrome/search-words.png" alt="Search - several words" width="360">
  <img src="assets/features/chrome/search-tag.png" alt="Search - #tag token" width="360">
</p>
<p>
  <img src="assets/features/chrome/filters-protected.png" alt="Filters - Protected chip" width="360">
  <img src="assets/features/chrome/filters-tags-picker.png" alt="Filters - Tags picker" width="360">
</p>

Two or more open side panels share one view: a filter, scope, sort or tag tick in one, and the
search text typed there, reach every other panel at once (Esc anywhere clears the search
everywhere). Switch it off in Settings → Customizations and each panel keeps its own.

<p>
  <img src="assets/features/chrome/shared-view-search.png" alt="Shared view - the search typed in another panel" width="360">
  <img src="assets/features/chrome/settings-shared-view.png" alt="Settings - Share filter, scope, sort and search across side panels" width="460">
</p>

→ [Usage: Side panel](USAGE.md#side-panel-main-ui) · [Usage: Tags](USAGE.md#tags)

## Tags

Colored labels on a page address: tick as many as you like in the row's **Tag URL…** checklist,
see them as pills on every tab of that page and in the hover tip, group the list by tag.

<p>
  <img src="assets/features/chrome/tags-assign-popover.png" alt="Tags - the Tag URL… checklist" width="360">
  <img src="assets/features/chrome/tags-row-pills.png" alt="Tags - pills on a row" width="360">
</p>
<p>
  <img src="assets/features/chrome/tags-group-by-tag.png" alt="Tags - group by tag" width="360">
</p>

A tagged page keeps its `#fragment` (Settings → Tags → **Keep the #fragment**, on by default): hash-routed
pages are one page per route — an entry with a `#` covers that exact address, one without covers every
fragment. A tag switched off in Settings, or given by a switched-off rule, shows struck through on the row,
in the hover tip and in the Tags picker (Settings → Customizations decides whether to show or hide them).

<p>
  <img src="assets/features/chrome/tags-fragment-tip.png" alt="Tags - a tagged page with its #fragment in the hover tip" width="360">
  <img src="assets/features/chrome/settings-tag-fragment.png" alt="Settings - Tags, Keep the #fragment" width="460">
</p>

→ [Usage: Tags](USAGE.md#tags)

## Windows and parking

The quick launch (▦) lists every window with its counts; a window's ⋯ menu renames it and
gives it a color. A tab's menu moves it to another window, and with several rows ticked the
bottom bar and the menu act on all of them. Park a window you do not need right now: its
tabs wait closed in the **Parked windows** scope until you restore it.

<p>
  <img src="assets/features/chrome/quick-launch-windows.png" alt="Quick launch - Windows view" width="360">
  <img src="assets/features/chrome/window-color-menu.png" alt="Window menu - color" width="360">
</p>
<p>
  <img src="assets/features/chrome/move-tab-menu.png" alt="Row menu - Move tab to another window" width="360">
  <img src="assets/features/chrome/bulk-bar-selection.png" alt="Selection - bulk bar" width="360">
</p>
<p>
  <img src="assets/features/chrome/parked-scope.png" alt="Parked windows scope" width="360">
</p>

→ [Usage: Parked windows](USAGE.md#parked-windows)

## Grouping and sorting

Group by window is the default; group by domain, title, Chrome tab group or tag, fold them
all with one click, or use a flat list, most recently used first.

<p>
  <img src="assets/features/chrome/group-by-domain.png" alt="Group by domain" width="360">
  <img src="assets/features/chrome/group-by-tabgroup.png" alt="Group by tab group" width="360">
</p>
<p>
  <img src="assets/features/chrome/sort-recent.png" alt="Flat list, most recent first" width="360">
</p>

## Actions and duplicates

Hover a row for snooze, protect and close; tick rows for bulk Snooze / Wake / Protect / Close
from the bottom bar. The quick launch's **Dupes** view lists every page open more than once,
and the ☰ menu's **Cleanup Duplicates** keeps one copy of each.

<p>
  <img src="assets/features/chrome/row-actions-hover.png" alt="Row hover actions" width="360">
  <img src="assets/features/chrome/bulk-snooze-selection.png" alt="Bulk snooze of a selection" width="360">
</p>
<p>
  <img src="assets/features/chrome/quick-launch-dupes.png" alt="Quick launch - Dupes view" width="360">
  <img src="assets/features/chrome/quick-actions-menu.png" alt="Quick actions menu" width="360">
</p>

**Snooze inactive tabs now** — the ☰ menu (and the same button in Settings → Automatic Snooze)
runs the automatic-snooze check right away: every tab the rules allow goes, the inactivity
threshold does not apply, and a toast says how many.

<p>
  <img src="assets/features/chrome/quick-actions-snooze-now.png" alt="Quick actions - Snooze inactive tabs now" width="360">
  <img src="assets/features/chrome/snooze-now-toast.png" alt="Snooze now - the count toast" width="360">
</p>

**Row menus from the keyboard** — `↓` / `↑` move the amber cursor, `Shift+F10`, the `Menu` key or `.`
(outside the search) opens that row's menu with its first item in focus; arrows walk it, `→` enters a
submenu, `←` leaves it, `Esc` closes. Every menu of the panel works the same way.

<p>
  <img src="assets/features/chrome/keyboard-row-menu.png" alt="Row menu opened from the keyboard, first item in focus" width="360">
  <img src="assets/features/chrome/keyboard-row-submenu.png" alt="Row menu - a submenu entered with the right arrow" width="360">
</p>

→ [Usage: Duplicates](USAGE.md#duplicates) · [Usage: Keyboard](USAGE.md#keyboard)

## Settings

Six tabs under the title: **General** (zoom, density and theme — the panel follows at once —, automatic
snooze thresholds and exclusions, customizations, useful links, data), **Protected sites**, **Keep alive**
(marks that reload a page on a timer), **Tags**, **Tab names** and **Changes**. Every table edits in place;
removals can be undone.

<p>
  <img src="assets/features/chrome/settings-tabs-general.png" alt="Settings - the tab strip, General pane" width="460">
  <img src="assets/features/chrome/settings-tabs-protected.png" alt="Settings - the Protected sites pane" width="460">
</p>
<p>
  <img src="assets/features/chrome/settings-interface-dark.png" alt="Settings - Interface, dark theme" width="460">
  <img src="assets/features/chrome/panel-dark-theme.png" alt="Side panel - dark theme" width="300">
</p>
<p>
  <img src="assets/features/chrome/settings-auto-snooze.png" alt="Settings - Automatic snooze" width="460">
  <img src="assets/features/chrome/settings-snooze-now.png" alt="Settings - Snooze inactive tabs now" width="460">
</p>
<p>
  <img src="assets/features/chrome/settings-protected-sites.png" alt="Settings - Protected sites" width="460">
</p>
<p>
  <img src="assets/features/chrome/settings-keep-alive.png" alt="Settings - Keep tabs alive" width="460">
  <img src="assets/features/chrome/settings-tags.png" alt="Settings - Tags" width="460">
</p>

Keep alive by URL or by domain: a row's menu marks the page or the whole site (one tab of it reloads per
timer); the mark's menu names its kind — *Pause keep-alive (domain)*, *Remove domain from keep-alive* — in
the row menu and in the quick launch's Alive view. A paused mark keeps its **kept alive** badge, struck
through; Settings → Customizations can hide struck-through tags and marks instead.

<p>
  <img src="assets/features/chrome/keep-alive-row-menu.png" alt="Row menu - Keep alive domain / Keep alive URL" width="360">
  <img src="assets/features/chrome/keep-alive-paused-badge.png" alt="Side panel - a paused mark's badge struck through" width="360">
</p>
<p>
  <img src="assets/features/chrome/alive-mark-menu.png" alt="Alive view - the mark menu names the kind" width="360">
  <img src="assets/features/chrome/settings-keep-alive-domain.png" alt="Settings - a domain mark in the keep-alive table" width="460">
</p>
<p>
  <img src="assets/features/chrome/settings-show-disabled.png" alt="Settings - Show disabled tags and paused keep-alive marks" width="460">
</p>

Drag a row by its ⋮⋮ grip to reorder the keep-alive marks (the Alive view's and the catch-up reloads'
order) and the tagged page rules.

<p>
  <img src="assets/features/chrome/settings-reorder-keep-alive.png" alt="Settings - dragging a keep-alive mark onto another row" width="460">
  <img src="assets/features/chrome/settings-reorder-tag-pages.png" alt="Settings - dragging a tagged page rule onto another row" width="460">
</p>

Protect or keep alive for a while: hover **Protect domain ▸** / **Protect URL ▸** / **Keep alive domain ▸** /
**Keep alive URL ▸** in a row's menu for *Always (default)* or 1 hour to 1 week (the click itself is
Always). The row reads **temporary protected** / **temporary keep alive**, the hover tip adds the time left,
and the rule or mark removes itself when the time is up (Restore last removal brings it back).

<p>
  <img src="assets/features/chrome/protect-durations-menu.png" alt="Row menu - Protect domain durations" width="360">
  <img src="assets/features/chrome/temporary-badges-tip.png" alt="Side panel - temporary badges with the time left in the tip" width="360">
</p>

Settings → Protected Sites is a table like the keep-alive marks: **Expires** (Never or a duration, counted
from the pick) and a live **Time left** on both tables, an **On** box that keeps a rule listed but protecting
nothing (the panel shows the badge struck through), and drag-to-reorder by the ⋮⋮ grip.

<p>
  <img src="assets/features/chrome/settings-protected-expires.png" alt="Settings - Protected sites with Expires and Time left" width="460">
  <img src="assets/features/chrome/settings-keep-alive-expires.png" alt="Settings - keep-alive marks with Expires and Time left" width="460">
</p>
<p>
  <img src="assets/features/chrome/protected-disabled-badge.png" alt="Side panel - a disabled rule's badge struck through" width="360">
  <img src="assets/features/chrome/settings-reorder-protected.png" alt="Settings - dragging a protected site onto another row" width="460">
</p>

Name a tab yourself: **Rename tab…** in a row's menu (before Copy URL) asks for the name, the row shows it in
place of the page title (the hover tip keeps the real one, search finds both), and Settings → Tab names
lists every rule — a pattern in the tagged-page forms and its name, an **On** box, how many open tabs it
covers, drag-to-reorder (the first rule covering a page wins) and an Add row.

<p>
  <img src="assets/features/chrome/rename-tab-menu.png" alt="Row menu - Rename tab… before Copy URL" width="360">
  <img src="assets/features/chrome/rename-tab-dialog.png" alt="Side panel - the Rename tab dialog" width="360">
</p>
<p>
  <img src="assets/features/chrome/tab-name-row-tip.png" alt="Side panel - a renamed row, the real title in the hover tip" width="360">
  <img src="assets/features/chrome/settings-tab-names.png" alt="Settings - the Tab names table" width="460">
</p>

→ [Usage: Automatic snooze](USAGE.md#automatic-snooze) · [Protecting sites](USAGE.md#protecting-sites) · [Keeping tabs alive](USAGE.md#keeping-tabs-alive) · [Tags](USAGE.md#tags)
