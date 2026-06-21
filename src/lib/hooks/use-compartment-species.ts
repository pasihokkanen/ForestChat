"use client";

import { useState, useEffect } from "react";
import type { CompartmentSpecies } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { useForestStore } from "@/lib/store";

interface UseCompartmentSpeciesResult {
  data: CompartmentSpecies[];
  loading: boolean;
  error: string | null;
}

export function useCompartmentSpecies(
  forestIds: string[] | null
): UseCompartmentSpeciesResult {
  const [data, setData] = useState<CompartmentSpecies[]>([]);
  const [loading, setLoading] = useState<boolean>(
    forestIds !== null && forestIds.length > 0
  );
  const [error, setError] = useState<string | null>(null);
  const refetchCounter = useForestStore((s) => s.refetchCounter);

  useEffect(() => {
    if (forestIds === null || forestIds.length === 0) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchData = async () => {
      try {
        const supabase = createClient();
        const { data: result, error: fetchError } = await supabase
          .from("compartment_species")
          .select("*")
          .in("forest_id", forestIds)
          .order("stand_id")
          .order("species");

        if (cancelled) return;

        if (fetchError) {
          setError(fetchError.message);
          setData([]);
        } else {
          const species = (result as CompartmentSpecies[]) ?? [];
          setData(species);
          useForestStore.getState().setCompartmentSpecies(species);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setData([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [forestIds, refetchCounter]);

  return { data, loading, error };
}
