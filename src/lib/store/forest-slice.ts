import type { StateCreator } from "zustand";
import type {
  Forest,
  Compartment,
  CompartmentSpecies,
  Operation,
  PlanMetadata,
} from "@/types/database";

type LoadingKey = "forest" | "compartments";

export interface ForestSlice {
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

export const createForestSlice: StateCreator<ForestSlice> = (set) => ({
  ...initialState,

  setForest: (forest) => set({ forest }),

  setCompartments: (compartments) => set({ compartments }),

  setCompartmentSpecies: (compartmentSpecies) => set({ compartmentSpecies }),

  setOperations: (operations) => set({ operations }),

  setPlanMetadata: (metadata) => set({ planMetadata: metadata }),

  setLoading: (key, value) =>
    set(
      key === "forest"
        ? { isLoadingForest: value }
        : { isLoadingCompartments: value }
    ),

  setError: (error) => set({ forestError: error }),

  clearForestData: () => set(initialState),

  triggerRefetch: () =>
    set((state) => ({ refetchCounter: state.refetchCounter + 1 })),
});
