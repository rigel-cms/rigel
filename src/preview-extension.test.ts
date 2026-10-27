import { expect, test, vi } from "vitest";
import { emptyBody } from "./article-body";
import { cleanupPreview, patchPreview } from "./preview";

const { sanitize, mount, events } = vi.hoisted(() => {
  const events: string[] = [];
  return {
    events,
    sanitize: vi.fn((_html: string, _options: Record<string, unknown>) => ({ querySelectorAll: () => [] })),
    mount: vi.fn(() => { events.push("mount"); return () => { events.push("cleanup"); }; }),
  };
});
vi.mock("dompurify", () => ({ default: { sanitize } }));
vi.mock("./editor/lib/extension-preview", () => ({ mountExtensionPreviews: mount }));

test("website bridge sanitizes explicit markers before mounting and cleans up before repatching or disposal", () => {
  const element = {
    dataset: { rigelRichtext: "$body" },
    children: [],
    isConnected: true,
    getAttribute: () => null,
    hasAttribute: () => false,
    replaceChildren: () => events.push("replace"),
  };
  const doc = {
    documentElement: { children: [], hasAttribute: () => false, getAttribute: () => null },
    querySelectorAll: (selector: string) => selector === "[data-rigel-richtext]" ? [element] : [],
  } as unknown as Document;
  const state = emptyBody();
  const node = { type: "extension", version: 1, name: "cta", data: { text: '<script>alert(1)</script>' } };
  state.root.children = [node];
  patchPreview(doc, {}, state);
  expect(events).toEqual(["replace", "mount"]);
  expect(sanitize).toHaveBeenCalledWith(expect.stringContaining("&lt;script&gt;"), expect.objectContaining({
    ALLOW_DATA_ATTR: false,
    ALLOWED_ATTR: expect.arrayContaining(["data-rigel-extension", "data-rigel-extension-data", "data-rigel-embed"]),
  }));
  const options = sanitize.mock.calls[0]?.[1] as unknown as { ALLOWED_TAGS: string[]; ALLOWED_ATTR: string[] };
  expect(options.ALLOWED_TAGS).not.toContain("script");
  expect(options.ALLOWED_ATTR).not.toContain("onclick");
  patchPreview(doc, {}, state);
  expect(mount).toHaveBeenCalledTimes(1);
  patchPreview(doc, {}, emptyBody());
  expect(events).toEqual(["replace", "mount", "cleanup", "replace", "mount"]);
  cleanupPreview(doc);
  expect(events.at(-1)).toBe("cleanup");
  patchPreview(doc, {}, state, { editingBody: element as unknown as Element });
  expect(mount).toHaveBeenCalledTimes(2);
  patchPreview(doc, {}, state);
  expect(mount).toHaveBeenCalledTimes(3);
  element.isConnected = false;
  patchPreview(doc, {}, state, { editingBody: element as unknown as Element });
  expect(events.at(-1)).toBe("cleanup");
  cleanupPreview(doc);
});
