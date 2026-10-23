export function tooltipPosition(rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return {
    left: Math.max(8, Math.min((rect.left + rect.right - width) / 2, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(rect.top >= height + 14 ? rect.top - height - 6 : rect.bottom + 6, viewportHeight - height - 8)),
  };
}

let provider: ReturnType<typeof createTooltips> | undefined;

export function tooltipRoot(root: HTMLElement) {
  provider ??= createTooltips();
  const remove = provider.register(root);
  return { destroy: remove };
}

function createTooltips() {
  let tip: HTMLDivElement | undefined;
  let anchor: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let opening: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let view: Window | null = null;
  let pointerTime = 0;
  let users = 0;
  const id = "rigel-tooltip";

  function hide() {
    clearTimeout(timer);
    clearTimeout(opening);
    if (view) view.cancelAnimationFrame(frame);
    if (anchor) {
      const ids = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(value => value && value !== id);
      if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" ")); else anchor.removeAttribute("aria-describedby");
    }
    anchor = null;
    if (tip?.matches(":popover-open")) tip.hidePopover();
    tip?.remove();
  }

  function update() {
    if (!anchor || !tip || !view) return;
    if (!anchor.isConnected || !anchor.checkVisibility() || !anchor.dataset.tooltip) { hide(); return; }
    if (tip.textContent !== anchor.dataset.tooltip) tip.textContent = anchor.dataset.tooltip;
    const position = tooltipPosition(anchor.getBoundingClientRect(), tip.offsetWidth, tip.offsetHeight, view.innerWidth, view.innerHeight);
    tip.style.left = `${position.left}px`;
    tip.style.top = `${position.top}px`;
    frame = view.requestAnimationFrame(update);
  }

  function show(target: HTMLElement) {
    hide();
    if (!target.isConnected || !target.checkVisibility() || !target.dataset.tooltip) return;
    const doc = target.ownerDocument;
    tip ??= doc.createElement("div");
    tip.id = id;
    tip.className = "rigel-tooltip";
    tip.setAttribute("role", "tooltip");
    tip.popover = "manual";
    anchor = target;
    view = doc.defaultView;
    const scope = target.closest("dialog, .rigel") ?? target.parentElement!;
    scope.append(tip);
    tip.textContent = target.dataset.tooltip;
    target.setAttribute("aria-describedby", [...new Set([...(target.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean), id])].join(" "));
    try { tip.showPopover(); update(); }
    catch (error) {
      if ((error as DOMException)?.name !== "InvalidStateError") throw error;
      opening = setTimeout(() => { if (anchor !== target) return; if (!target.isConnected || !target.checkVisibility()) { hide(); return; } tip!.showPopover(); update(); }, 0);
    }
  }

  function register(root: HTMLElement) {
    users++;
    const doc = root.ownerDocument;
    const win = doc.defaultView!;
    const target = (event: Event) => {
      const element = (event.target as Element)?.closest?.<HTMLElement>("[data-tooltip]");
      return element && root.contains(element) && element.closest(".rigel") ? element : null;
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      if (event.target === tip) { clearTimeout(timer); return; }
      const element = target(event);
      if (!element || element.contains(event.relatedTarget as Node | null) || element === anchor || element === doc.activeElement) return;
      hide(); timer = setTimeout(() => show(element), 450);
    };
    const out = (event: PointerEvent) => {
      const element = target(event);
      if (element?.contains(event.relatedTarget as Node | null)) return;
      if (event.relatedTarget === tip || anchor?.contains(event.relatedTarget as Node | null)) return;
      if (anchor === doc.activeElement) return;
      clearTimeout(timer); timer = setTimeout(hide, 150);
    };
    const focus = (event: FocusEvent) => {
      const element = target(event);
      if (element && Date.now() - pointerTime > 700) show(element);
    };
    const down = () => { pointerTime = Date.now(); hide(); };
    const key = (event: KeyboardEvent) => {
      pointerTime = 0;
      if (event.key !== "Escape") return;
      const visible = !!anchor;
      hide();
      if (visible) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const listeners = [["pointerover", over], ["pointerout", out], ["focusin", focus], ["focusout", hide], ["pointerdown", down], ["click", hide], ["keydown", key]] as const;
    for (const [name, listener] of listeners) root.addEventListener(name, listener as EventListener, true);
    win.addEventListener("blur", hide);
    win.addEventListener("resize", hide);
    win.addEventListener("scroll", hide, true);
    return () => {
      hide();
      for (const [name, listener] of listeners) root.removeEventListener(name, listener as EventListener, true);
      win.removeEventListener("blur", hide); win.removeEventListener("resize", hide);
      win.removeEventListener("scroll", hide, true);
      if (!--users) { tip = undefined; provider = undefined; }
    };
  }
  return { register };
}
