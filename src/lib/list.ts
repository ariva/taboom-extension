// Ordered-list edits shared by the tables that let a row be dragged onto another.

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
