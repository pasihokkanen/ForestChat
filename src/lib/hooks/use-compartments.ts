"use client";

import { useState, useEffect } from "react";
import type { Compartment } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

interface UseCompartmentsResult {
  data: Compartment[];
  loading: boolean;
  error: string | null;
}

export function useCompartments(
  forestIds: string[] | null
): UseCompartmentsResult {
  const [data, setData] = useState<Compartment[]>([]);
  const [loading, setLoading] = useState<boolean>(
    forestIds !== null && forestIds.length > 0
  );
  const [error, setError] = useState<string | null>(null);

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

    const fetchCompartments = async () => {
      try {
        const supabase = createClient();
        const { data: result, error: fetchError } = await supabase
          .from("compartments")
          .select("*")
          .in("forest_id", forestIds)
          .order("stand_id")
          .order("forest_id")
          .limit(1000);

        if (cancelled) return;

        if (fetchError) {
          setError(fetchError.message);
          setData([]);
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
  }, [forestIds]);

  return { data, loading, error };
}
