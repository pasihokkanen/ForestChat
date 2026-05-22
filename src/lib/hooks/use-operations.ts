"use client";

import { useState, useEffect } from "react";
import type { Operation } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

interface UseOperationsResult {
  data: Operation[];
  loading: boolean;
  error: string | null;
}

export function useOperations(
  forestId: string | null
): UseOperationsResult {
  const [data, setData] = useState<Operation[]>([]);
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

    const fetchOperations = async () => {
      try {
        const supabase = createClient();
        const { data: result, error: fetchError } = await supabase
          .from("operations")
          .select("*")
          .eq("forest_id", forestId)
          .order("year", { ascending: true })
          .order("compartment_id", { ascending: true });

        if (cancelled) return;

        if (fetchError) {
          setError(fetchError.message);
          setData([]);
        } else {
          setData((result as Operation[]) ?? []);
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

    fetchOperations();

    return () => {
      cancelled = true;
    };
  }, [forestId]);

  return { data, loading, error };
}