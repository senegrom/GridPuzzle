// A modal section with an inert background. Preserve pre-existing inert flags
// and restore them on every exit, including playback failure and page hiding.
export function cameraModal(panel, fallbackFocus, doc = document) {
  let saved = [], previous = null, opened = false;
  const focusable = () => [...(panel.querySelectorAll?.('button, a[href], input, select, textarea, [tabindex]') ?? [])]
    .filter(node => !node.disabled && node.tabIndex >= 0 && !node.closest?.('[hidden], [inert]') &&
      (!node.getClientRects || node.getClientRects().length));
  function trap(event) {
    if (!opened) return;
    if (event.type === "focusin") {
      if (!panel.contains(event.target)) (focusable()[0] ?? panel).focus();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable(), index = items.indexOf(doc.activeElement);
    if (!items.length) { event.preventDefault(); panel.focus(); return; }
    if (event.shiftKey ? index <= 0 : index < 0 || index === items.length - 1) {
      event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus();
    }
  }
  return {
    open() {
      if (opened) return;
      opened = true; previous = doc.activeElement;
      for (let child = panel; child?.parentElement; child = child.parentElement)
        for (const sibling of child.parentElement.children)
          if (sibling !== child) { saved.push([sibling, sibling.inert]); sibling.inert = true; }
      panel.setAttribute?.("role", "dialog"); panel.setAttribute?.("aria-modal", "true");
      panel.tabIndex = -1;
      doc.addEventListener("keydown", trap); doc.addEventListener("focusin", trap);
    },
    close() {
      if (!opened) return;
      opened = false;
      doc.removeEventListener?.("keydown", trap); doc.removeEventListener?.("focusin", trap);
      for (const [node, inert] of saved) node.inert = inert;
      saved = [];
      panel.removeAttribute?.("aria-modal");
      const target = previous?.isConnected && !panel.contains?.(previous) ? previous : fallbackFocus;
      target?.focus?.(); previous = null;
    },
  };
}
