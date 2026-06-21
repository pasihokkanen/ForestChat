"use client";

import { useState, useEffect } from "react";
import type { PlanMetadata } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { useForestStore } from "@/lib/store";

export function usePlanMetadata(forestIds: string[] | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetchCounter = useForestStore((s) => s.refetchCounter);

  useEffect(() => {
    if (!forestIds || forestIds.length === 0) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchMeta = async () => {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("plan_metadata")
        .select("*")
        .in("forest_id", forestIds)
        .limit(1)
        .single();

      if (cancelled) return;

      if (fetchError && fetchError.code !== "PGRST116") {
        setError(fetchError.message);
        useForestStore.getState().setPlanMetadata(null as unknown as PlanMetadata);
      } else {
        useForestStore.getState().setPlanMetadata(
          (data as PlanMetadata) ?? (null as unknown as PlanMetadata)
        );
      }
      setLoading(false);
    };

    fetchMeta();
    return () => { cancelled = true; };
  }, [forestIds, refetchCounter]);

  return { loading, error };
}
