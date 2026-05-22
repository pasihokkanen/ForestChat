"use client";

interface ImportProgressProps {
  stage:
    | "idle"
    | "fetching_boundary"
    | "fetching_stands"
    | "storing"
    | "done"
    | "error";
  message?: string;
}

const stages: { key: ImportProgressProps["stage"]; label: string }[] = [
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

export default function ImportProgress({
  stage,
  message,
}: ImportProgressProps) {
  if (stage === "idle" || stage === "done") return null;

  const currentIndex = stages.findIndex((s) => s.key === stage);

  return (
    <div className="mt-4 rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm">
      {stage === "error" ? (
        <p className="text-red-700">{message || "Import failed"}</p>
      ) : (
        <div className="space-y-1">
          {stages.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              {i < currentIndex ? (
                <span className="text-green-600">✓</span>
              ) : i === currentIndex ? (
                <span className="animate-spin text-blue-600">⏳</span>
              ) : (
                <span className="text-gray-300">○</span>
              )}
              <span
                className={
                  i < currentIndex
                    ? "text-green-700"
                    : i === currentIndex
                      ? "text-blue-700 font-medium"
                      : "text-gray-400"
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
