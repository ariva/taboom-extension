// Which text field is being typed in right now: `input` fired, its `change` (or blur) has not.
// A page that re-renders its form on every storage event leaves such a field alone instead of
// overwriting the keystrokes; once the field commits or blurs, the store's value shows again.
const typing = new WeakSet<EventTarget>();

document.addEventListener(
  "input",
  (event) => {
    if (event.target) {
      typing.add(event.target);
    }
  },
  true,
);
for (const settled of ["change", "blur"]) {
  document.addEventListener(
    settled,
    (event) => {
      if (event.target) {
        typing.delete(event.target);
      }
    },
    true,
  );
}

export function isBeingTyped(element: Element): boolean {
  return typing.has(element);
}
