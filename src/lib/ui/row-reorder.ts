// Drag a table row onto another to reorder the list behind the table. Rows carry their key in
// data-key; the dragged row gets .dragging, the row under the pointer .drop-target (the host's
// CSS draws both). The drop hands both keys to the writer and the host re-renders on true.
import { closest, setSvgMarkup } from "../dom.ts";

const GRIP =
  '<svg viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="2.5" r="1.3"/><circle cx="7" cy="2.5" r="1.3"/><circle cx="3" cy="7" r="1.3"/><circle cx="7" cy="7" r="1.3"/><circle cx="3" cy="11.5" r="1.3"/><circle cx="7" cy="11.5" r="1.3"/></svg>';

// six dots: the row is a drag handle
export function dragGrip(): HTMLSpanElement {
  const grip = document.createElement("span");
  grip.className = "drag-grip";
  grip.title = "Drag to reorder";
  setSvgMarkup(grip, GRIP);
  return grip;
}

export function initRowReorder(
  rows: HTMLElement,
  onDrop: (draggedKey: string, targetKey: string) => Promise<boolean>,
): void {
  let draggedKey: string | null = null; // dataTransfer is unreadable during dragover — track here
  let dropRow: HTMLElement | null = null;
  const clearDropRow = () => {
    dropRow?.classList.remove("drop-target");
    dropRow = null;
  };
  // a row of this table other than the dragged one
  const rowUnder = (event: Event): HTMLElement | null => {
    const row = closest(event.target, "tr[data-key]");
    return row && rows.contains(row) && draggedKey !== null && row.dataset.key !== draggedKey ? row : null;
  };
  rows.addEventListener("dragstart", (event) => {
    const row = closest(event.target, "tr[data-key]");
    draggedKey = row?.dataset.key ?? null;
    row?.classList.add("dragging"); // dimmed while it travels; a re-render or dragend clears it
  });
  rows.addEventListener("dragover", (event) => {
    const row = rowUnder(event);
    if (!row) {
      clearDropRow();
      return; // not a target — the browser shows the no-drop cursor
    }
    event.preventDefault();
    if (row !== dropRow) {
      clearDropRow();
      dropRow = row;
      row.classList.add("drop-target");
    }
  });
  rows.addEventListener("drop", async (event) => {
    const row = rowUnder(event);
    const dragged = draggedKey;
    draggedKey = null;
    clearDropRow();
    const target = row?.dataset.key;
    if (dragged !== null && target !== undefined && (await onDrop(dragged, target))) {
      event.preventDefault();
    }
  });
  rows.addEventListener("dragend", (event) => {
    draggedKey = null;
    clearDropRow();
    closest(event.target, "tr[data-key]")?.classList.remove("dragging");
  });
}
