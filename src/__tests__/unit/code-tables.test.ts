import { describe, it, expect } from "vitest";
import {
  MAINGROUP_MAP,
  FERTILITYCLASS_MAP,
  DEVELOPMENTCLASS_MAP,
  mapWfsCode,
  mapWfsNumericCode,
} from "@/lib/import/code-tables";

describe("Code Tables", () => {
  it("maps main group codes to species names", () => {
    expect(mapWfsNumericCode(MAINGROUP_MAP, 1)).toBe("pine");
    expect(mapWfsNumericCode(MAINGROUP_MAP, 2)).toBe("spruce");
    expect(mapWfsNumericCode(MAINGROUP_MAP, 3)).toBe("broadleaf");
    expect(mapWfsNumericCode(MAINGROUP_MAP, 99)).toBeNull();
  });

  it("maps fertility class codes", () => {
    expect(mapWfsNumericCode(FERTILITYCLASS_MAP, 3)).toBe("mesic");
    expect(mapWfsNumericCode(FERTILITYCLASS_MAP, 1)).toBe("herb-rich");
    expect(mapWfsNumericCode(FERTILITYCLASS_MAP, null)).toBeNull();
  });

  it("maps development class codes", () => {
    expect(mapWfsCode(DEVELOPMENTCLASS_MAP, "Y1")).toBe("regeneration_ready");
    expect(mapWfsCode(DEVELOPMENTCLASS_MAP, "T1")).toBe("young_thinning");
    expect(mapWfsCode(DEVELOPMENTCLASS_MAP, "S0")).toBe("seedling");
    expect(mapWfsCode(DEVELOPMENTCLASS_MAP, "XY")).toBe("unknown:XY");
    expect(mapWfsCode(DEVELOPMENTCLASS_MAP, null)).toBeNull();
  });

  it("handles string input for numeric codes", () => {
    expect(mapWfsNumericCode(MAINGROUP_MAP, "2")).toBe("spruce");
  });
});
