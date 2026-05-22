"use client";

import { useState, useEffect } from "react";
import type { Forest } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

interface UseForestResult {
  data: Forest | null;
  loading: boolean;
  error: string | null;
}

export function useForest(forestId: string | null): UseForestResult {
  const [data, setData] = useState<Forest | null>(null);
  const [loading, setLoading] = useState<boolean>(forestId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (forestId === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchForest = async () => {
      try {
        const supabase = createClient();
        const { data: result, error: fetchError } = await supabase
          .from("forests")
          .select("*")
          .eq("id", forestId)
          .single();

        if (cancelled) return;

        if (fetchError) {
          // PGRST116 = no rows returned
          if (fetchError.code === "PGRST116") {
            setData(null);
          } else {
            setError(fetchError.message);
            setData(null);
          }
        } else {
          setData(result as Forest);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setData(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchForest();

    return () => {
      cancelled = true;
    };
  }, [forestId]);

  return { data, loading, error };
}