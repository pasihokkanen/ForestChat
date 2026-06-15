"use client";

import { toolLabel, toolStatusLabel, type Language } from "@/lib/i18n";

interface ToolCallCardProps {
  name: string;
  status: "running" | "done" | "error";
  result?: string;
  language: Language;
}

const STATUS_ICONS = {
  running: (
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
  done: (
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
  error: (
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
};

export default function ToolCallCard({
  name,
  status,
  result,
  language,
}: ToolCallCardProps) {
  const icon = STATUS_ICONS[status];
  const label = toolLabel(name, language);
  const statusLabel = toolStatusLabel(status, language);

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm hover:scale-[1.01] transition-transform">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-gray-700 dark:text-gray-300 text-xs">
            {label}
          </span>
          <span
            className={`text-[10px] font-medium ${
              status === "done"
                ? "text-green-600 dark:text-green-400"
                : status === "error"
                  ? "text-red-600 dark:text-red-400"
                  : "text-blue-600 dark:text-blue-400"
            }`}
          >
            {statusLabel}
          </span>
        </div>
        {result && status === "done" && (
          <pre className="mt-2 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-sans leading-relaxed max-h-32 overflow-y-auto border-t border-gray-200 dark:border-gray-700 pt-2">
            {result}
          </pre>
        )}
        {status === "error" && result && (
          <pre className="mt-2 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap font-sans leading-relaxed border-t border-gray-200 dark:border-gray-700 pt-2">
            ⚠️ {result}
          </pre>
        )}
      </div>
    </div>
  );
}
