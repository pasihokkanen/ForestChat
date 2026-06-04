"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useForestStore } from "@/lib/store";
import { dashboardLabels } from "@/lib/i18n";
import type { Forest } from "@/types/database";
import Link from "next/link";

export default function ForestList() {
  const [forests, setForests] = useState<Forest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const language = useForestStore((s) => s.language) ?? "en";
  const L = dashboardLabels(language);

  const fetchForests = () => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        setLoading(false);
        return;
      }

      supabase
        .from("forests")
        .select("*")
        .eq("owner_id", session.user.id)
        .order("created_at", { ascending: false })
        .then(({ data, error: err }) => {
          if (err) {
            setError(err.message);
          } else {
            setForests(data ?? []);
          }
          setLoading(false);
        });
    });
  };

  useEffect(() => {
    fetchForests();
  }, []);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    setConfirmId(null);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(`/api/forests/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || L.deleteFailed);
      }

      setForests((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : L.deleteFailed
      );
    } finally {
      setDeleting(null);
    }
  };

  const startDelete = (id: string) => {
    setConfirmId(id);
  };

  const cancelDelete = () => {
    setConfirmId(null);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-400">
        {L.loadError}: {error}
      </div>
    );
  }

  if (forests.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">{L.noForests}</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
          {L.noForestsHint}
        </p>
        <Link
          href="/forest/new"
          className="mt-4 inline-block rounded-md bg-green-700 dark:bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 dark:hover:bg-green-700 transition-colors"
        >
          {L.importForestBtn}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {forests.map((forest) => (
        <div
          key={forest.id}
          className="block rounded-lg border border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-700 hover:bg-green-50/50 transition-colors"
        >
          <div className="px-5 py-4 flex items-center justify-between">
            <Link
              href={`/forest/${forest.id}`}
              className="flex-1 flex items-center justify-between"
            >
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{forest.name}</h3>
                <div className="flex gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {forest.property_id && <span>{forest.property_id}</span>}
                  {forest.municipality && <span>· {forest.municipality}</span>}
                  {forest.total_area_ha && (
                    <span>· {forest.total_area_ha.toLocaleString()} ha</span>
                  )}
                </div>
              </div>
              <span className="text-gray-400 dark:text-gray-500">→</span>
            </Link>

            {confirmId === forest.id ? (
              <div className="flex items-center gap-2 ml-4">
                <span className="text-xs text-red-600 dark:text-red-400">{L.deleteConfirm}</span>
                <button
                  onClick={() => handleDelete(forest.id)}
                  disabled={deleting === forest.id}
                  className="rounded bg-red-600 dark:bg-red-500 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 dark:hover:bg-red-600 disabled:opacity-50"
                >
                  {deleting === forest.id ? "…" : L.deleteYes}
                </button>
                <button
                  onClick={cancelDelete}
                  disabled={deleting === forest.id}
                  className="rounded bg-gray-200 dark:bg-gray-700 px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  {L.deleteNo}
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  startDelete(forest.id);
                }}
                className="ml-4 rounded-md border border-red-200 dark:border-red-800 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:border-red-300 dark:hover:border-red-700 transition-colors"
              >
                {L.deleteBtn}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
