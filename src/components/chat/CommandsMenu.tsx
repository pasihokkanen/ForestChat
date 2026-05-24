"use client";

import { useForestStore } from "@/lib/store";

interface CommandsMenuProps {
  /** Called when user clicks a command — inserts text into the chat input */
  onInsertCommand?: (text: string) => void;
}

export default function CommandsMenu({ onInsertCommand }: CommandsMenuProps) {
  const { activeModel } = useForestStore();

  const handleNew = () => {
    onInsertCommand?.("/new ");
    useForestStore.getState().toggleCommands();
  };

  const handleModel = () => {
    onInsertCommand?.("/model ");
    useForestStore.getState().toggleCommands();
  };

  return (
    <div className="w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
        📋 Chat Commands
      </div>
      <button
        onClick={handleNew}
        className="w-full flex flex-col items-start px-3 py-2.5 text-sm text-gray-800 hover:bg-gray-50 transition-colors text-left border-b border-gray-100"
      >
        <span className="font-mono text-blue-600">/new</span>
        <span className="text-xs text-gray-500 mt-0.5">
          Start a new conversation
        </span>
      </button>
      <button
        onClick={handleModel}
        className="w-full flex flex-col items-start px-3 py-2.5 text-sm text-gray-800 hover:bg-gray-50 transition-colors text-left"
      >
        <span className="font-mono text-blue-600">/model &lt;name&gt;</span>
        <span className="text-xs text-gray-500 mt-0.5">
          Change AI model
        </span>
        <span className="text-xs text-gray-400 mt-0.5">
          Current: {activeModel}
        </span>
      </button>
    </div>
  );
}