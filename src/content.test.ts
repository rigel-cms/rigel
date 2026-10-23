import { expect, test, vi } from "vitest";

vi.mock("@sveltejs/vite-plugin-svelte", () => { throw new Error("Content helpers must not load the integration"); });

test("content entrypoint exports schema helpers without loading Vite or Svelte", async () => {
  const content = await import("./content");
  for (const name of ["defineCopy", "defineSchema", "defineDocument", "defineObject", "defineField"]) {
    expect(content).toHaveProperty(name, expect.any(Function));
  }
});
