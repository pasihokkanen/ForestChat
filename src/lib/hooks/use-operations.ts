"use client";

import { useState, useEffect } from "react";
import type { Operation } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { useForestStore } from "@/lib/store";

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
  const refetchCounter = useForestStore((s) => s.refetchCounter);

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
        const PAGE_SIZE = 1000;

        // Paginate: Supabase PostgREST max-rows caps .limit() at 1000 server-side.
        // Use .range() to fetch all pages until an empty/incomplete page signals end.
        let allOps: Operation[] = [];
        let from = 0;

        while (true) {
          const to = from + PAGE_SIZE - 1;
          const { data: result, error: fetchError } = await supabase
            .from("operations")
            .select("*")
            .eq("forest_id", forestId)
            .order("year", { ascending: true })
            .order("compartment_id", { ascending: true })
            .range(from, to);

          if (cancelled) return;

          if (fetchError) {
            setError(fetchError.message);
            setData([]);
            return;
          }

          const page = (result as Operation[]) ?? [];
          allOps = allOps.concat(page);

          // Stop when page is smaller than PAGE_SIZE (last page or no more rows)
          if (page.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }

        if (cancelled) return;
        setData(allOps);
        useForestStore.getState().setOperations(allOps);
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
  }, [forestId, refetchCounter]);

  return { data, loading, error };
}