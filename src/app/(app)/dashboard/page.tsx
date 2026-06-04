"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useForestStore } from "@/lib/store";
import { dashboardLabels } from "@/lib/i18n";
import ForestList from "@/components/forest/ForestList";
import Link from "next/link";

export default function DashboardPage() {
  const [stats, setStats] = useState<{ count: number; totalArea: number } | null>(null);
  const [hasForests, setHasForests] = useState<boolean | null>(null);
  const language = useForestStore((s) => s.language) ?? "en";
  const L = dashboardLabels(language);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;

      const { data: forests, error: forestErr } = await supabase
        .from("forests")
        .select("id")
        .eq("owner_id", session.user.id);

      if (forestErr || !forests) return;

      const count = forests.length;
      setHasForests(count > 0);

      if (count === 0) {
        setStats({ count: 0, totalArea: 0 });
        return;
      }

      const forestIds = forests.map((f: { id: string }) => f.id);
      const { data: comps, error: compErr } = await supabase
        .from("compartments")
        .select("area_ha")
        .in("forest_id", forestIds);

      if (compErr || !comps) {
        setStats({ count, totalArea: 0 });
        return;
      }

      const totalArea = comps.reduce(
        (sum: number, c: { area_ha: number | null }) => sum + (c.area_ha ?? 0),
        0
      );

      setStats({ count, totalArea });
    });
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{L.myForests}</h1>
        <Link
          href="/forest/new"
          className="rounded-md bg-green-700 dark:bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 dark:hover:bg-green-700 transition-colors"
        >
          {L.importForest}
        </Link>
      </div>

      {/* Summary stats */}
      {stats && stats.count > 0 && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">{L.statForests}</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
              {stats.count}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">{L.statTotalArea}</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
              {Math.round(stats.totalArea).toLocaleString()} ha
            </p>
          </div>
        </div>
      )}

      {/* Getting Started card when no forests */}
      {hasForests === false && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-8 text-center mb-6">
          <div className="text-4xl mb-3">🌲</div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {L.gettingStarted}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-sm mx-auto">
            {L.gettingStartedDesc}
          </p>
          <Link
            href="/forest/new"
            className="mt-4 inline-block rounded-md bg-green-700 dark:bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-800 dark:hover:bg-green-700 transition-colors"
          >
            {L.importFirstForest}
          </Link>
        </div>
      )}

      <ForestList />
    </div>
  );
}
