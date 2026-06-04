"use client";

import { useForestStore } from "@/lib/store";
import { getCommandGroups } from "@/lib/i18n";

interface CommandsMenuProps {
  /** Called when user clicks a command — inserts text into the chat input */
  onInsertCommand?: (text: string) => void;
}

export default function CommandsMenu({ onInsertCommand }: CommandsMenuProps) {
  const { activeModel, language } = useForestStore();
  const lang = language ?? "en";
  const groups = getCommandGroups(lang, activeModel ?? "unknown");

  const handleNew = () => {
    onInsertCommand?.("/new ");
    useForestStore.getState().toggleCommands();
  };

  const handleModel = () => {
    onInsertCommand?.("/model ");
    useForestStore.getState().toggleCommands();
  };

  return (
    <div className="w-72 max-w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-[480px] overflow-y-auto">
      {groups.map((group, gi) => (
        <div key={gi}>
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">
            {group.heading}
          </div>
          {gi === 0 ? (
            <>
              <button
                onClick={handleNew}
                className="w-full flex flex-col items-start px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left border-b border-gray-100 dark:border-gray-700"
              >
                <span className="font-mono text-blue-600 dark:text-blue-400">/new</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {lang === "fi" ? "Aloita uusi keskustelu" : "Start a new conversation"}
                </span>
              </button>
              <button
                onClick={handleModel}
                className="w-full flex flex-col items-start px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
              >
                <span className="font-mono text-blue-600 dark:text-blue-400">/model &lt;name&gt;</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {lang === "fi" ? "Vaihda tekoälymalli" : "Change AI model"}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {lang === "fi" ? `Nykyinen: ${activeModel}` : `Current: ${activeModel}`}
                </span>
              </button>
            </>
          ) : (
            group.prompts.map((prompt, pi) => (
              <button
                key={pi}
                onClick={() => {
                  onInsertCommand?.(prompt.text);
                  useForestStore.getState().toggleCommands();
                }}
                className="w-full text-left px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700 last:border-b-0"
              >
                {prompt.label}
              </button>
            ))
          )}
        </div>
      ))}
    </div>
  );
}