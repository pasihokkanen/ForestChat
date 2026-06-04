"use client";

import { importLabels } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";

export type ImportStage =
  | "idle"
  | "parsing_csv"
  | "fetching_boundary"
  | "fetching_stands"
  | "storing"
  | "storing_stands"
  | "storing_species"
  | "done"
  | "error";

interface ImportProgressProps {
  stage: ImportStage;
  message?: string;
  language?: Language;
}

type StageKey = "stageBoundary" | "stageStands" | "stageStoring" | "stageParseCsv" | "stageStoreStands" | "stageStoreSpecies";

const API_STAGE_TO_LABEL: Record<string, StageKey> = {
  fetching_boundary: "stageBoundary",
  fetching_stands: "stageStands",
  storing: "stageStoring",
};

const CSV_STAGE_TO_LABEL: Record<string, StageKey> = {
  parsing_csv: "stageParseCsv",
  fetching_boundary: "stageBoundary",
  storing_stands: "stageStoreStands",
  storing_species: "stageStoreSpecies",
};

const stages = [
  { keys: API_STAGE_TO_LABEL, isCsv: false },
  { keys: CSV_STAGE_TO_LABEL, isCsv: true },
];

export default function ImportProgress({
  stage,
  message,
  language = "en",
}: ImportProgressProps) {
  if (stage === "idle" || stage === "done") return null;

  const L = importLabels(language);

  const isCsvPath =
    stage === "parsing_csv" ||
    stage === "storing_stands" ||
    stage === "storing_species";

  const mapping = isCsvPath ? CSV_STAGE_TO_LABEL : API_STAGE_TO_LABEL;
  const entries = Object.entries(mapping);
  const currentIndex = entries.findIndex(([key]) => key === stage);

  return (
    <div className="mt-4 rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-4 py-3 text-sm">
      {stage === "error" ? (
        <p className="text-red-700 dark:text-red-400">
          {message || L.importFailedFallback}
        </p>
      ) : (
        <div className="space-y-1">
          {entries.map(([key, labelKey], i) => (
            <div key={key} className="flex items-center gap-2">
              {i < currentIndex ? (
                <span className="text-green-600">✓</span>
              ) : i === currentIndex ? (
                <span className="animate-spin text-blue-600 dark:text-blue-400">
                  ⏳
                </span>
              ) : (
                <span className="text-gray-300">○</span>
              )}
              <span
                className={
                  i < currentIndex
                    ? "text-green-700 dark:text-green-400"
                    : i === currentIndex
                      ? "text-blue-700 dark:text-blue-300 font-medium"
                      : "text-gray-400 dark:text-gray-500"
                }
              >
                {(L as unknown as Record<string, string>)[labelKey]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
