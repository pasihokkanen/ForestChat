"use client";

import type { CompartmentFeatureCollection } from "@/types/database";

export const testCompartments: CompartmentFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[24.00, 62.50], [24.012, 62.50], [24.012, 62.512], [24.00, 62.512], [24.00, 62.50]]],
        ],
      },
      properties: {
        id: "test-1",
        stand_id: "1",
        main_species: "Pine",
        development_class: "young_thinning",
        site_type: "mesic",
        area_ha: 2.5,
        age_years: 35,
        volume_m3: 280,
        basal_area: null,
        avg_diameter: null,
        avg_height: null,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[24.015, 62.50], [24.027, 62.50], [24.027, 62.512], [24.015, 62.512], [24.015, 62.50]]],
        ],
      },
      properties: {
        id: "test-2",
        stand_id: "2",
        main_species: "Spruce",
        development_class: "mature_thinning",
        site_type: "mesic",
        area_ha: 3.1,
        age_years: 55,
        volume_m3: 450,
        basal_area: null,
        avg_diameter: null,
        avg_height: null,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[24.03, 62.50], [24.042, 62.50], [24.042, 62.512], [24.03, 62.512], [24.03, 62.50]]],
        ],
      },
      properties: {
        id: "test-3",
        stand_id: "3",
        main_species: "Birch",
        development_class: "regeneration_ready",
        site_type: "herb-rich heath",
        area_ha: 1.8,
        age_years: 65,
        volume_m3: 320,
        basal_area: null,
        avg_diameter: null,
        avg_height: null,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[24.00, 62.515], [24.012, 62.515], [24.012, 62.527], [24.00, 62.527], [24.00, 62.515]]],
        ],
      },
      properties: {
        id: "test-4",
        stand_id: "4",
        main_species: "Pine",
        development_class: "seedling_small",
        site_type: "sub-xeric",
        area_ha: 4.2,
        age_years: 8,
        volume_m3: 15,
        basal_area: null,
        avg_diameter: null,
        avg_height: null,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[24.015, 62.515], [24.027, 62.515], [24.027, 62.527], [24.015, 62.527], [24.015, 62.515]]],
        ],
      },
      properties: {
        id: "test-5",
        stand_id: "5",
        main_species: "Spruce",
        development_class: "mature_thinning",
        site_type: "mesic",
        area_ha: 2.9,
        age_years: 60,
        volume_m3: 520,
        basal_area: null,
        avg_diameter: null,
        avg_height: null,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[24.03, 62.515], [24.042, 62.515], [24.042, 62.527], [24.03, 62.527], [24.03, 62.515]]],
        ],
      },
      properties: {
        id: "test-6",
        stand_id: "6",
        main_species: "Pine",
        development_class: "regeneration_ready",
        site_type: "sub-xeric",
        area_ha: 3.5,
        age_years: 95,
        volume_m3: 380,
        basal_area: null,
        avg_diameter: null,
        avg_height: null,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[24.045, 62.50], [24.057, 62.50], [24.057, 62.512], [24.045, 62.512], [24.045, 62.50]]],
        ],
      },
      properties: {
        id: "test-7",
        stand_id: "7",
        main_species: "Birch",
        development_class: "young_thinning",
        site_type: "herb-rich heath",
        area_ha: 1.5,
        age_years: 25,
        volume_m3: 180,
        basal_area: null,
        avg_diameter: null,
        avg_height: null,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[24.045, 62.515], [24.057, 62.515], [24.057, 62.527], [24.045, 62.527], [24.045, 62.515]]],
        ],
      },
      properties: {
        id: "test-8",
        stand_id: "8",
        main_species: "Spruce",
        development_class: "open_area",
        site_type: "mesic",
        area_ha: 2.1,
        age_years: 0,
        volume_m3: 250,
        basal_area: null,
        avg_diameter: null,
        avg_height: null,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[24.00, 62.53], [24.012, 62.53], [24.012, 62.542], [24.00, 62.542], [24.00, 62.53]]],
        ],
      },
      properties: {
        id: "test-9",
        stand_id: "9",
        main_species: "Pine",
        development_class: "seed_tree",
        site_type: "xeric",
        area_ha: 1.2,
        age_years: 110,
        volume_m3: 90,
        basal_area: null,
        avg_diameter: null,
        avg_height: null,
      },
    },
    {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[24.015, 62.53], [24.027, 62.53], [24.027, 62.542], [24.015, 62.542], [24.015, 62.53]]],
        ],
      },
      properties: {
        id: "test-10",
        stand_id: "10",
        main_species: "Spruce",
        development_class: "seedling_small",
        site_type: "mesic",
        area_ha: 3.0,
        age_years: 5,
        volume_m3: 10,
        basal_area: null,
        avg_diameter: null,
        avg_height: null,
      },
    },
  ],
};
