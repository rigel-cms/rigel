export type TooltipSide = "top" | "bottom" | "left" | "right";
export type TooltipAlign = "start" | "center" | "end";

export function tooltipPosition(rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">, width: number, height: number, viewportWidth: number, viewportHeight: number, position: TooltipSide = "top", align: TooltipAlign = "center") {
  const sides: TooltipSide[] = ["top", "bottom", "left", "right"];
  const preferred = sides.includes(position) ? position : "top";
  const opposite: Record<TooltipSide, TooltipSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const candidates = [preferred, opposite[preferred], ...sides.filter(side => side !== preferred && side !== opposite[preferred])];
  const space = { top: rect.top - 8, bottom: viewportHeight - rect.bottom - 8, left: rect.left - 8, right: viewportWidth - rect.right - 8 };
  const needed = { top: height + 8, bottom: height + 8, left: width + 8, right: width + 8 };
  const side = candidates.find(side => space[side] >= needed[side]) ?? candidates.reduce((best, side) => space[side] / needed[side] > space[best] / needed[best] ? side : best);
  const vertical = side === "top" || side === "bottom";
  const start = vertical ? rect.left : rect.top, end = vertical ? rect.right : rect.bottom, size = vertical ? width : height;
  const cross = align === "start" ? start : align === "end" ? end - size : (start + end - size) / 2;
  const left = vertical ? cross : side === "left" ? rect.left - width - 8 : rect.right + 8;
  const top = !vertical ? cross : side === "top" ? rect.top - height - 8 : rect.bottom + 8;
  return {
    left: Math.max(8, Math.min(left, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(top, viewportHeight - height - 8)),
    side,
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
    const preferred = anchor.closest<HTMLElement>("[data-tooltip-position]")?.dataset.tooltipPosition as TooltipSide | undefined;
    const align = anchor.closest<HTMLElement>("[data-tooltip-align]")?.dataset.tooltipAlign as TooltipAlign | undefined;
    const position = tooltipPosition(anchor.getBoundingClientRect(), tip.offsetWidth, tip.offsetHeight, view.innerWidth, view.innerHeight, preferred ?? (anchor.closest(".body-toolbar, .visual-toolbar") ? "bottom" : "top"), align);
    tip.dataset.side = position.side;
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
      if (!element || element.contains(event.relatedTarget as Node | null) || element === anchor) return;
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
