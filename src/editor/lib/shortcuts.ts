export type ShortcutId = "search" | "save" | "toggleMode" | "toggleSidebar" | "toggleProperties" | "help";

const BINDINGS: Record<ShortcutId, { key: string; shift: boolean }> = {
  search: { key: "k", shift: false },
  save: { key: "s", shift: false },
  toggleMode: { key: "e", shift: true },
  toggleSidebar: { key: "b", shift: false },
  toggleProperties: { key: "y", shift: true },
  help: { key: "/", shift: false },
};

const TYPING_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "month", "week", "time"]);

export function matchShortcut(event: KeyboardEvent): ShortcutId | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing || event.repeat || event.defaultPrevented) return null;
  const key = event.key.toLowerCase();
  for (const [id, binding] of Object.entries(BINDINGS) as [ShortcutId, (typeof BINDINGS)[ShortcutId]][]) {
    if (binding.key === "/" ? key === "/" || key === "?" : key === binding.key && event.shiftKey === binding.shift) return id;
  }
  return null;
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function shortcutLabel(id: ShortcutId, mac = isMac()): string {
  const { key, shift } = BINDINGS[id];
  return [mac ? "⌘" : "Ctrl", ...(shift ? ["Shift"] : []), key.toUpperCase()].join(" + ");
}

export function shortcutAria(id: ShortcutId): string {
  const { key, shift } = BINDINGS[id];
  const name = shift ? `Shift+${key.toUpperCase()}` : key.toUpperCase();
  return `Meta+${name} Control+${name}`;
}

export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (node.isContentEditable === true) return true;
  const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  if (tag === "textarea" || tag === "select") return true;
  if (tag !== "input") return false;
  const type = typeof node.type === "string" ? node.type.toLowerCase() : "text";
  return TYPING_INPUTS.has(type);
}

export function shortcutOverlayOpen(doc: Document | null = typeof document === "undefined" ? null : document): boolean {
  if (!doc) return false;
  const selector = 'dialog[open], .rigel-modal-backdrop, .palette-backdrop, [popover]:popover-open:not([role="tooltip"]):not(.toast-stack)';
  const roots = [doc];
  for (const frame of doc.querySelectorAll("iframe")) {
    try { const inner = frame.contentDocument; if (inner) roots.push(inner); } catch {}
  }
  return roots.some(root => {
    const view = root.defaultView;
    return [...root.querySelectorAll(selector)].some(element => element.getClientRects().length > 0 && view?.getComputedStyle(element).visibility !== "hidden");
  });
}
