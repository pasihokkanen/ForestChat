"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ImportProgress from "@/components/import/ImportProgress";
import * as Papa from "papaparse";

type ImportTab = "api" | "csv";
type ImportStage =
  | "idle"
  | "parsing_csv"
  | "fetching_boundary"
  | "fetching_stands"
  | "storing"
  | "storing_stands"
  | "storing_species"
  | "done"
  | "error";

export default function NewForestPage() {
  const [tab, setTab] = useState<ImportTab>("api");
  const [propertyId, setPropertyId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<ImportStage>("idle");

  // CSV-specific state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<{
    standCount: number;
    totalVolume: number;
  } | null>(null);

  const router = useRouter();

  // Client-side CSV preview on file select
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setCsvFile(file);
    setCsvPreview(null);

    if (!file) return;

    // Parse in browser for preview
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        delimiter: ";",
        skipEmptyLines: true,
        dynamicTyping: false,
      });

      if (result.data.length === 0) return;

      let totalVolume = 0;
      for (const row of result.data) {
        const m3 = parseFloat(row["total_m3"] ?? "0");
        if (!isNaN(m3)) totalVolume += m3;
      }

      setCsvPreview({
        standCount: result.data.length,
        totalVolume: Math.round(totalVolume),
      });
    };
    reader.onerror = () => {
      setError("Failed to read CSV file");
    };
    reader.readAsText(file);
  }

  // ─── API import (unchanged) ───

  async function handleApiSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setStage("fetching_boundary");

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

      setStage("done");
      await new Promise((r) => setTimeout(r, 600));
      router.push(`/forest/${data.forest_id}`);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  // ─── CSV import ───

  async function handleCsvSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!csvFile) return;

    setLoading(true);
    setError(null);
    setStage("parsing_csv");

    await new Promise((r) => setTimeout(r, 400));
    setStage("fetching_boundary");

    await new Promise((r) => setTimeout(r, 400));
    setStage("storing_stands");

    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      formData.append("property_id", propertyId.trim());
      if (name.trim()) formData.append("name", name.trim());

      setStage("storing_species");

      const response = await fetch("/api/import/csv", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Import failed");
      }

      setStage("done");
      await new Promise((r) => setTimeout(r, 600));
      router.push(`/forest/${data.forest_id}`);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  const isApi = tab === "api";

  return (
    <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-200 dark:border-gray-700">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Import Stand Data
        </h1>

        {/* Tabs */}
        <div className="mt-4 flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => { setTab("api"); setError(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              isApi
                ? "border-green-600 dark:border-green-400 text-green-700 dark:text-green-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            Metsäkeskus API
          </button>
          <button
            onClick={() => { setTab("csv"); setError(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              !isApi
                ? "border-green-600 dark:border-green-400 text-green-700 dark:text-green-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            CSV File
          </button>
        </div>

        {/* Tab description */}
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          {isApi
            ? "Import stand data from the Finnish Forest Centre (Metsäkeskus) open WFS API. Enter your property ID to fetch stands automatically."
            : "Import stand data from a CSV file. The file must contain stand attributes, species breakdown, and polygon geometry in WKT format."}
        </p>

        <form
          onSubmit={isApi ? handleApiSubmit : handleCsvSubmit}
          className="mt-4 space-y-4"
        >
          {/* Property ID (shared) */}
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

          {/* CSV file input (CSV tab only) */}
          {!isApi && (
            <div>
              <label
                htmlFor="csvFile"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Stand data CSV file
              </label>
              <input
                id="csvFile"
                type="file"
                accept=".csv"
                required
                onChange={handleFileSelect}
                className="mt-1 block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-4 file:rounded-md file:border-0 file:bg-green-50 dark:file:bg-green-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-green-700 dark:file:text-green-300 hover:file:bg-green-100 dark:hover:file:bg-green-800"
              />
              {/* Preview */}
              {csvPreview && (
                <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                  {csvPreview.standCount} stands · {csvPreview.totalVolume.toLocaleString()} m³ total volume
                </p>
              )}
            </div>
          )}

          {/* Forest name (shared) */}
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
            disabled={
              loading || !propertyId.trim() || (!isApi && !csvFile)
            }
            className="w-full rounded-md bg-green-700 dark:bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 dark:hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Importing…" : "Import Stand Data"}
          </button>
        </form>
      </div>
    </div>
  );
}
