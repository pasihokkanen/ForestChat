import { describe, it, expect } from "vitest";
import { bboxFromGeometry } from "@/lib/import/wfs-client";

describe("WFS Client — bboxFromGeometry", () => {
  it("computes bbox from a simple polygon", () => {
    const polygon: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    };

    const bbox = bboxFromGeometry(polygon);
    expect(bbox).toEqual([0, 0, 10, 10]);
  });

  it("computes bbox from a MultiPolygon", () => {
    const multiPolygon: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [5, 0],
            [5, 5],
            [0, 5],
            [0, 0],
          ],
        ],
        [
          [
            [7, 7],
            [12, 7],
            [12, 12],
            [7, 12],
            [7, 7],
          ],
        ],
      ],
    };

    const bbox = bboxFromGeometry(multiPolygon);
    expect(bbox).toEqual([0, 0, 12, 12]);
  });
});
