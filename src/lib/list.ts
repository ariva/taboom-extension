// Ordered-list edits shared by the Settings tables: drag-to-reorder and the row's On switch.

// the On switch: `disabled: true` added or the key dropped (absent = on, so stored objects stay
// comparable). undefined when the item is unknown or already in that state
export function setItemEnabled<T extends { disabled?: boolean }>(
  list: T[],
  item: T | undefined,
  enabled: boolean,
): T[] | undefined {
  if (!item || (item.disabled ?? false) === !enabled) {
    return undefined;
  }
  const { disabled: _previous, ...live } = item;
  return list.map((candidate) =>
    candidate === item ? (enabled ? (live as T) : { ...(live as T), disabled: true }) : candidate,
  );
}

// the dragged item lands at the target's old index: after it when dragged down, before it
// when dragged up (the rule of every drag-to-reorder table). undefined = nothing moves
export function moveItemTo<T>(
  list: T[],
  keyOf: (item: T) => string,
  draggedKey: string,
  targetKey: string,
): T[] | undefined {
  const from = list.findIndex((item) => keyOf(item) === draggedKey);
  const to = list.findIndex((item) => keyOf(item) === targetKey);
  if (from === -1 || to === -1 || from === to) {
    return undefined;
  }
  const next = [...list];
  const [dragged] = next.splice(from, 1);
  if (dragged) {
    next.splice(to, 0, dragged);
  }
  return next;
}
