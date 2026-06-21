import type { StateCreator } from "zustand";
import type {
  Forest,
  Compartment,
  CompartmentSpecies,
  Operation,
  PlanMetadata,
} from "@/types/database";

type LoadingKey = "forest" | "compartments" | "forests";

export interface ForestSlice {
  // ── Multi-forest (Phase A) ──
  forests: Forest[];             // all user's forests (loaded once)
  activeForestIds: string[];     // checked forests
  isLoadingForests: boolean;

  setForests: (forests: Forest[]) => void;
  toggleActiveForest: (id: string) => void;
  setActiveForests: (ids: string[]) => void;
  isActive: (id: string) => boolean;

  // ── Single-forest (legacy — holds data for one forest at a time,
  //     will hold COMBINED data from all active forests in Phase C) ──
  forest: Forest | null;
  compartments: Compartment[];
  compartmentSpecies: CompartmentSpecies[];
  operations: Operation[];
  planMetadata: PlanMetadata | null;
  isLoadingForest: boolean;
  isLoadingCompartments: boolean;
  forestError: string | null;
  refetchCounter: number;

  setForest: (forest: Forest) => void;
  setCompartments: (compartments: Compartment[]) => void;
  setCompartmentSpecies: (species: CompartmentSpecies[]) => void;
  setOperations: (operations: Operation[]) => void;
  setPlanMetadata: (metadata: PlanMetadata) => void;
  setLoading: (key: LoadingKey, value: boolean) => void;
  setError: (error: string | null) => void;
  clearForestData: () => void;
  triggerRefetch: () => void;
}

const initialState = {
  forests: [] as Forest[],
  activeForestIds: [] as string[],
  isLoadingForests: false,
  forest: null as Forest | null,
  compartments: [] as Compartment[],
  compartmentSpecies: [] as CompartmentSpecies[],
  operations: [] as Operation[],
  planMetadata: null as PlanMetadata | null,
  isLoadingForest: false,
  isLoadingCompartments: false,
  forestError: null as string | null,
  refetchCounter: 0,
};

export const createForestSlice: StateCreator<ForestSlice> = (set, get) => ({
  ...initialState,

  // ── Multi-forest setters ──
  setForests: (forests) => set({ forests }),

  toggleActiveForest: (id) =>
    set((state) => {
      const set = new Set(state.activeForestIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { activeForestIds: Array.from(set) };
    }),

  setActiveForests: (ids) => set({ activeForestIds: ids }),

  isActive: (id) => get().activeForestIds.includes(id),

  // ── Single-forest setters ──
  setForest: (forest) => set({ forest }),

  setCompartments: (compartments) => set({ compartments }),

  setCompartmentSpecies: (compartmentSpecies) => set({ compartmentSpecies }),

  setOperations: (operations) => set({ operations }),

  setPlanMetadata: (metadata) => set({ planMetadata: metadata }),

  setLoading: (key, value) =>
    set(
      key === "forest"
        ? { isLoadingForest: value }
        : key === "compartments"
        ? { isLoadingCompartments: value }
        : { isLoadingForests: value }
    ),

  setError: (error) => set({ forestError: error }),

  clearForestData: () => set(initialState),

  triggerRefetch: () =>
    set((state) => ({ refetchCounter: state.refetchCounter + 1 })),
});
