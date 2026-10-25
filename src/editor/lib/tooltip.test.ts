import { describe, expect, it } from "vitest";
import { tooltipPosition } from "./tooltip";

describe("tooltip placement", () => {
  const rect = { left: 100, right: 160, top: 100, bottom: 140 };
  it.each([
    ["top", 90, 62], ["bottom", 90, 148], ["left", 12, 105], ["right", 168, 105],
  ] as const)("honors %s placement with an eight-pixel gap", (side, left, top) => {
    expect(tooltipPosition(rect, 80, 30, 400, 300, side)).toEqual({ left, top, side });
  });
  it("aligns along the edge of the selected side", () => {
    expect(tooltipPosition(rect, 80, 30, 400, 300, "top", "start").left).toBe(100);
    expect(tooltipPosition(rect, 80, 30, 400, 300, "bottom", "end").left).toBe(80);
    expect(tooltipPosition(rect, 80, 30, 400, 300, "right", "start").top).toBe(100);
    expect(tooltipPosition(rect, 80, 30, 400, 300, "left", "end").top).toBe(110);
  });
  it("flips to the opposite side at viewport edges", () => {
    expect(tooltipPosition({ left: 0, right: 40, top: 0, bottom: 30 }, 80, 30, 400, 300)).toEqual({ left: 8, top: 38, side: "bottom" });
    expect(tooltipPosition({ left: 4, right: 44, top: 120, bottom: 160 }, 80, 30, 400, 300, "left")).toEqual({ left: 52, top: 125, side: "right" });
    expect(tooltipPosition({ left: 360, right: 396, top: 120, bottom: 160 }, 80, 30, 400, 300, "right")).toEqual({ left: 272, top: 125, side: "left" });
    expect(tooltipPosition({ left: 100, right: 160, top: 270, bottom: 296 }, 80, 30, 400, 300, "bottom")).toEqual({ left: 90, top: 232, side: "top" });
  });
  it("tries a perpendicular side if neither preferred direction fits", () => {
    expect(tooltipPosition({ left: 60, right: 120, top: 200, bottom: 240 }, 100, 30, 180, 400, "left")).toEqual({ left: 40, top: 162, side: "top" });
  });
  it("clamps to the viewport even when no side fits", () => {
    expect(tooltipPosition({ left: 380, right: 400, top: 280, bottom: 300 }, 80, 30, 400, 300)).toEqual({ left: 312, top: 242, side: "top" });
    expect(tooltipPosition({ left: 0, right: 40, top: 20, bottom: 40 }, 80, 80, 100, 100)).toEqual({ left: 8, top: 12, side: "bottom" });
  });
});
