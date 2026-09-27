// Custom dropdown for <select>s: a top-layer list that positions itself inside a
// narrow page (side panel) where the native popup lands off-screen.

// ---------- custom dropdown for the toolbar selects ----------
// Native <select> popups render mispositioned in the side panel (Chromium
// quirk, reproduced back to 0.2.14-era code: the popup anchors far right,
// mostly off-panel — often fully invisible). The <select>s stay as value
// store + change-event hub; the gestures that would open the native popup
// open this top-layer list instead.
const ddPop = document.createElement("div");
ddPop.className = "dd-pop";
ddPop.hidden = true;
ddPop.setAttribute("popover", "manual"); // top layer; own dismiss handling
document.body.append(ddPop);
let ddFor: HTMLSelectElement | null = null;

function closeDropdown(): void {
  ddFor = null;
  ddPop.hidden = true;
  try {
    ddPop.hidePopover();
  } catch {
    // not open / no popover API (tests)
  }
}

function openDropdown(select: HTMLSelectElement): void {
  ddFor = select;
  ddPop.textContent = "";
  for (const option of select.options) {
    if (option.hidden) {
      continue; // flag-gated sort options stay hidden here too
    }
    const item = document.createElement("button");
    item.type = "button";
    item.className = option.value === select.value ? "dd-item current" : "dd-item";
    item.textContent = option.textContent;
    item.addEventListener("click", () => {
      closeDropdown();
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    ddPop.append(item);
  }
  ddPop.hidden = false;
  try {
    ddPop.showPopover();
  } catch {
    // already open / no popover API (tests)
  }
  const rect = select.getBoundingClientRect();
  ddPop.style.minWidth = `${rect.width}px`;
  ddPop.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - ddPop.offsetWidth - 4))}px`;
  ddPop.style.top = `${Math.min(rect.bottom + 2, window.innerHeight - ddPop.offsetHeight - 4)}px`;
}

// wire one <select>: the gestures that would open the native popup open the list
export function attachDropdown(ddSelect: HTMLSelectElement): void {
  ddSelect.addEventListener("mousedown", (event) => {
    event.preventDefault(); // blocks the (mispositioned) native popup
    ddSelect.focus(); // preventDefault also swallowed the focus
    if (ddFor === ddSelect) {
      closeDropdown();
    } else {
      openDropdown(ddSelect);
    }
  });
  ddSelect.addEventListener("keydown", (event) => {
    // keys that would open the native popup; plain arrows keep their native
    // change-value-directly behavior (fires change, no popup involved)
    const opens =
      event.key === "Enter" ||
      event.key === " " ||
      (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp"));
    if (opens) {
      event.preventDefault();
      openDropdown(ddSelect);
    }
    if (event.key === "Escape" && ddFor) {
      event.stopPropagation(); // just close the list, don't clear the search
      closeDropdown();
    }
  });
}

document.addEventListener("mousedown", (event) => {
  const target = event.target as Node | null; // mouse events target DOM nodes
  if (ddFor && !ddPop.contains(target) && target !== ddFor) {
    closeDropdown();
  }
});
window.addEventListener("blur", closeDropdown);
