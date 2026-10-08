import { describe, expect, it } from "vitest";
import { computeDocumentWidth } from "@/lib/layout";

describe("computeDocumentWidth", () => {
  it("returns null when the panel is closed (no width override)", () => {
    expect(computeDocumentWidth(1920, null)).toBeNull();
  });

  it("returns a calc() width in pixels when the panel is open", () => {
    expect(computeDocumentWidth(1920, 360)).toBe("calc(100% - 360px)");
    expect(computeDocumentWidth(1024, 300)).toBe("calc(100% - 300px)");
    expect(computeDocumentWidth(2560, 560)).toBe("calc(100% - 560px)");
  });
});
