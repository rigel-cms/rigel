import { expect, test } from "vitest";
import { isTypingTarget, matchShortcut, shortcutAria, shortcutLabel } from "./shortcuts";

function event(key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false, ...init } as KeyboardEvent;
}

test("shortcut matcher maps modifier combinations to editor actions", () => {
  expect(matchShortcut(event("k", { metaKey: true }))).toBe("search");
  expect(matchShortcut(event("K", { ctrlKey: true }))).toBe("search");
  expect(matchShortcut(event("s", { metaKey: true }))).toBe("save");
  expect(matchShortcut(event("S", { ctrlKey: true }))).toBe("save");
  expect(matchShortcut(event("e", { metaKey: true, shiftKey: true }))).toBe("toggleMode");
  expect(matchShortcut(event("E", { ctrlKey: true, shiftKey: true }))).toBe("toggleMode");
  expect(matchShortcut(event("b", { metaKey: true }))).toBe("toggleSidebar");
  expect(matchShortcut(event("y", { ctrlKey: true, shiftKey: true }))).toBe("toggleProperties");
  expect(matchShortcut(event("/", { metaKey: true }))).toBe("help");
  expect(matchShortcut(event("?", { ctrlKey: true, shiftKey: true }))).toBe("help");
});

test("shortcut matcher leaves typing, composition, repeat and handled keys alone", () => {
  expect(matchShortcut(event("s"))).toBeNull();
  expect(matchShortcut(event("e", { shiftKey: true }))).toBeNull();
  expect(matchShortcut(event("s", { metaKey: true, altKey: true }))).toBeNull();
  expect(matchShortcut(event("s", { metaKey: true, isComposing: true }))).toBeNull();
  expect(matchShortcut(event("s", { metaKey: true, repeat: true }))).toBeNull();
  expect(matchShortcut(event("s", { metaKey: true, defaultPrevented: true }))).toBeNull();
  expect(matchShortcut(event("z", { metaKey: true }))).toBeNull();
  expect(matchShortcut(event("b", { metaKey: true, shiftKey: true }))).toBeNull();
});

test("labels and accessible key names follow the platform", () => {
  expect(shortcutLabel("search", true)).toBe("⌘ + K");
  expect(shortcutLabel("toggleMode", true)).toBe("⌘ + Shift + E");
  expect(shortcutLabel("toggleProperties", true)).toBe("⌘ + Shift + Y");
  expect(shortcutLabel("help", true)).toBe("⌘ + /");
  expect(shortcutLabel("search", false)).toBe("Ctrl + K");
  expect(shortcutLabel("toggleMode", false)).toBe("Ctrl + Shift + E");
  expect(shortcutLabel("toggleProperties", false)).toBe("Ctrl + Shift + Y");
  expect(shortcutAria("save")).toBe("Meta+S Control+S");
  expect(shortcutAria("toggleMode")).toBe("Meta+Shift+E Control+Shift+E");
});

test("typing targets are distinguished from controls and static content", () => {
  expect(isTypingTarget({ tagName: "INPUT", type: "text" })).toBe(true);
  expect(isTypingTarget({ tagName: "INPUT", type: "search" })).toBe(true);
  expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
  expect(isTypingTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
  expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
  expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
  expect(isTypingTarget({ tagName: "SPAN", isContentEditable: true })).toBe(true);
  expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
  expect(isTypingTarget(null)).toBe(false);
});
