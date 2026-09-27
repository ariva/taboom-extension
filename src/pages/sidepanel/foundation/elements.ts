// Static DOM references shared by the panel's features, looked up once — the ids
// are guaranteed by index.html.
import { getElementById } from "../../../lib/dom.ts";

export const searchInput = getElementById("search");
export const filterBar = getElementById("filters");
// getElementById types every lookup as an input — these two are the <select>s
export const scopeSelect = getElementById<HTMLSelectElement>("scope");
export const sortSelect = getElementById<HTMLSelectElement>("sort");
export const listEl = getElementById("tab-list");
export const bulkBar = getElementById("bulk-bar");
export const bulkCount = getElementById("bulk-count");
export const selectAllBox = getElementById("select-all");
export const collapseAllBtn = getElementById("collapse-all");
export const sortDirBtn = getElementById("sort-dir");
export const winListBtn = getElementById("win-list-btn");
export const winPop = getElementById("windows-pop");
