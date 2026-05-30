"use client";

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
}

const apiStages: { key: ImportStage; label: string }[] = [
  {
    key: "fetching_boundary",
    label: "Fetching property boundary from National Land Survey…",
  },
  {
    key: "fetching_stands",
    label: "Fetching stand data from Finnish Forest Centre…",
  },
  { key: "storing", label: "Processing and storing data…" },
];

const csvStages: { key: ImportStage; label: string }[] = [
  { key: "parsing_csv", label: "Parsing CSV file…" },
  {
    key: "fetching_boundary",
    label: "Fetching property boundary from National Land Survey…",
  },
  { key: "storing_stands", label: "Storing stand data…" },
  { key: "storing_species", label: "Importing species breakdown…" },
];

export default function ImportProgress({
  stage,
  message,
}: ImportProgressProps) {
  if (stage === "idle" || stage === "done") return null;

  // Pick stage list based on whether we're in a CSV path
  const isCsvPath =
    stage === "parsing_csv" ||
    stage === "storing_stands" ||
    stage === "storing_species";

  const stages = isCsvPath ? csvStages : apiStages;
  const currentIndex = stages.findIndex((s) => s.key === stage);

  return (
    <div className="mt-4 rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-4 py-3 text-sm">
      {stage === "error" ? (
        <p className="text-red-700 dark:text-red-400">
          {message || "Import failed"}
        </p>
      ) : (
        <div className="space-y-1">
          {stages.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
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
                {s.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
