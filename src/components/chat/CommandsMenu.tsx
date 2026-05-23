"use client";

import { useForestStore } from "@/lib/store";

export default function CommandsMenu() {
  const { activeModel } = useForestStore();

  const handleNew = () => {
    useForestStore.getState().clearChat();
    useForestStore.getState().toggleCommands();
  };

  const handleModel = () => {
    // Auto-fill the input with "/model " — find the input element
    const input = document.querySelector<HTMLTextAreaElement>(
      'textarea[data-chat-input]'
    );
    if (input) {
      input.value = "/model ";
      input.focus();
      // Set cursor at end
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
    useForestStore.getState().toggleCommands();
  };

  return (
    <div className="absolute top-full right-2 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
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