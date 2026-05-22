"use client";

import { useState, useEffect } from "react";
import type { Compartment } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

interface UseCompartmentsResult {
  data: Compartment[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches compartments for a forest from Supabase.
 * Uses the `get_compartments_geojson` RPC to get geometry as
 * GeoJSON (not WKB), so MapLibre can render it directly.
 */
export function useCompartments(
  forestId: string | null
): UseCompartmentsResult {
  const [data, setData] = useState<Compartment[]>([]);
  const [loading, setLoading] = useState<boolean>(forestId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (forestId === null) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchCompartments = async () => {
      try {
        const supabase = createClient();
        const { data: result, error: fetchError } = await supabase.rpc(
          "get_compartments_geojson",
          { p_forest_id: forestId }
        );

        if (cancelled) return;

        if (fetchError) {
          // Fall back to direct query if RPC not deployed yet
          const { data: fallback, error: fbError } = await supabase
            .from("compartments")
            .select("*")
            .eq("forest_id", forestId)
            .order("stand_id");

          if (cancelled) return;

          if (fbError) {
            setError(fbError.message);
            setData([]);
          } else {
            setData((fallback as Compartment[]) ?? []);
          }
        } else {
          setData((result as Compartment[]) ?? []);
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

    fetchCompartments();

    return () => {
      cancelled = true;
    };
  }, [forestId]);

  return { data, loading, error };
}