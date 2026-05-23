"use client";

interface ToolCallCardProps {
  name: string;
  status: "running" | "done" | "error";
  result?: string;
}

const STATUS_CONFIG = {
  running: {
    icon: (
      <svg
        className="animate-spin h-4 w-4 text-blue-500"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    ),
    label: "Running",
  },
  done: {
    icon: (
      <svg
        className="h-4 w-4 text-green-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    label: "Done",
  },
  error: {
    icon: (
      <svg
        className="h-4 w-4 text-red-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
    label: "Error",
  },
} as const;

/** Pretty-print a tool name for display */
function formatToolName(name: string): string {
  const labelMap: Record<string, string> = {
    generate_plan: "Generating plan...",
    get_stand: "Fetching stand data...",
    search_stands: "Searching stands...",
    plan_summary: "Calculating summary...",
    year_operations: "Fetching operations...",
    add_operation: "Adding operation...",
    remove_operation: "Removing operation...",
    check_harvest_sustainability: "Checking sustainability...",
    validate_plan: "Validating plan...",
  };
  return labelMap[name] ?? `Running ${name}...`;
}

export default function ToolCallCard({
  name,
  status,
  result,
}: ToolCallCardProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          {config.icon}
          <span className="font-medium text-gray-700 text-xs">
            {formatToolName(name)}
          </span>
          <span
            className={`text-[10px] font-medium ${
              status === "done"
                ? "text-green-600"
                : status === "error"
                  ? "text-red-600"
                  : "text-blue-600"
            }`}
          >
            {config.label}
          </span>
        </div>
        {result && status === "done" && (
          <pre className="mt-2 text-xs text-gray-600 whitespace-pre-wrap font-sans leading-relaxed max-h-32 overflow-y-auto border-t border-gray-200 pt-2">
            {result}
          </pre>
        )}
        {status === "error" && result && (
          <pre className="mt-2 text-xs text-red-600 whitespace-pre-wrap font-sans leading-relaxed border-t border-gray-200 pt-2">
            ⚠️ {result}
          </pre>
        )}
      </div>
    </div>
  );
}