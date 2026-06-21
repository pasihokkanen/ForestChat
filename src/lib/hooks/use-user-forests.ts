"use client";

import { useState, useEffect } from "react";
import type { Forest } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

interface UseUserForestsResult {
  forests: Forest[];
  loading: boolean;
  error: string | null;
}

/** Fetches all forests for the authenticated user on mount.
 *  Called once in (app)/layout.tsx to populate the forest selector. */
export function useUserForests(): UseUserForestsResult {
  const [forests, setForests] = useState<Forest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchForests = async () => {
      try {
        const supabase = createClient();
        const { data, error: fetchError } = await supabase
          .from("forests")
          .select("*")
          .order("name");

        if (cancelled) return;

        if (fetchError) {
          setError(fetchError.message);
          setForests([]);
        } else {
          setForests((data as Forest[]) ?? []);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setForests([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchForests();

    return () => {
      cancelled = true;
    };
  }, []);

  return { forests, loading, error };
}
