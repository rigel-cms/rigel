import { describe, expect, it } from "vitest";
import { tooltipPosition } from "./tooltip";

describe("tooltip placement", () => {
  it("centers above and flips below at the top edge", () => {
    expect(tooltipPosition({ left: 100, right: 140, top: 100, bottom: 130 }, 80, 30, 400, 300)).toEqual({ left: 80, top: 64 });
    expect(tooltipPosition({ left: 0, right: 40, top: 0, bottom: 30 }, 80, 30, 400, 300)).toEqual({ left: 8, top: 36 });
  });
  it("clamps both edges even when neither side fits", () => {
    expect(tooltipPosition({ left: 380, right: 400, top: 280, bottom: 300 }, 80, 30, 400, 300)).toEqual({ left: 312, top: 244 });
    expect(tooltipPosition({ left: 0, right: 40, top: 20, bottom: 40 }, 80, 80, 100, 100)).toEqual({ left: 8, top: 12 });
  });
});
