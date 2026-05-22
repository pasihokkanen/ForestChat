"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ImportProgress from "@/components/import/ImportProgress";

export default function NewForestPage() {
  const [propertyId, setPropertyId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<
    "idle" | "fetching_boundary" | "fetching_stands" | "storing" | "done" | "error"
  >("idle");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStage("fetching_boundary");

    // Brief delay so user sees the first stage
    await new Promise((r) => setTimeout(r, 400));
    setStage("fetching_stands");

    try {
      const response = await fetch("/api/import/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId.trim(),
          name: name.trim() || undefined,
        }),
      });

      setStage("storing");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Import failed");
      }

      // Show done briefly before navigating
      setStage("done");
      await new Promise((r) => setTimeout(r, 600));
      router.push(`/forest/${data.forest_id}`);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-200 dark:border-gray-700">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Import Forest Data
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Enter your Finnish property ID (kiinteistötunnus). ForestChat will
          automatically fetch your property boundary and stand data from Finnish
          open data sources.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="propertyId"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Property ID
            </label>
            <input
              id="propertyId"
              type="text"
              required
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              placeholder="989-405-0001-0405"
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm shadow-sm focus:border-green-500 dark:focus:border-green-400 focus:ring-1 focus:ring-green-500 dark:focus:ring-green-400 font-mono dark:bg-gray-900 dark:text-gray-100"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Format: XXX-XXX-XXXX-XXXX. Dashes are optional — the API
              auto-normalizes.
            </p>
          </div>

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Forest name (optional)
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hokkala"
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm shadow-sm focus:border-green-500 dark:focus:border-green-400 focus:ring-1 focus:ring-green-500 dark:focus:ring-green-400 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
              {error}
            </div>
          )}

          <ImportProgress
            stage={stage}
            message={stage === "error" ? (error ?? undefined) : undefined}
          />

          <button
            type="submit"
            disabled={loading || !propertyId.trim()}
            className="w-full rounded-md bg-green-700 dark:bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 dark:hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Importing…" : "Import"}
          </button>
        </form>
      </div>
    </div>
  );
}