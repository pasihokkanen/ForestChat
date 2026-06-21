"use client";

import { useRef, useState, useCallback } from "react";

export type UploadStatus = "idle" | "selected" | "uploading" | "done" | "error";

interface FileUploadBarProps {
  onFileReady?: (path: string, filename: string) => void;
  language?: string;
}

export default function FileUploadBar({ onFileReady, language }: FileUploadBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setErrorMsg("Only CSV files are accepted");
      setStatus("error");
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setStatus("selected");
    setErrorMsg("");
  }, []);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    setStatus("uploading");
    setErrorMsg("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/chat/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      const data = await res.json();
      setStatus("done");
      onFileReady?.(data.path, data.filename);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
    }
  }, [selectedFile, onFileReady]);

  const handleClear = useCallback(() => {
    setSelectedFile(null);
    setStatus("idle");
    setErrorMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleTriggerFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const statusIcon = () => {
    switch (status) {
      case "uploading":
        return (
          <svg className="animate-spin w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
          </svg>
        );
      case "done":
        return (
          <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        );
      case "error":
        return (
          <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        );
    }
  };

  return (
    <div className="px-3 py-2 shrink-0">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileSelect}
        className="hidden"
      />

      <div className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-800/50 dark:to-blue-900/20 px-3 py-2 border border-gray-200/60 dark:border-gray-700/60">
        <button
          onClick={handleTriggerFile}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-200/60 dark:hover:bg-gray-700/60 text-gray-500 dark:text-gray-400 transition-colors shrink-0"
          title={language === "fi" ? "Valitse CSV-tiedosto" : "Select CSV file"}
          aria-label={language === "fi" ? "Valitse CSV-tiedosto" : "Select CSV file"}
        >
          {statusIcon()}
        </button>

        <div className="flex-1 min-w-0">
          {selectedFile ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600 dark:text-gray-300 truncate">
                {selectedFile.name}
              </span>
              {status === "done" && (
                <span className="text-xs text-green-600 dark:text-green-400 shrink-0">
                  {language === "fi" ? "Ladattu" : "Uploaded"}
                </span>
              )}
              {status === "error" && (
                <span className="text-xs text-red-600 dark:text-red-400 truncate">
                  {errorMsg}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {language === "fi" ? "Tuo metsä CSV-tiedostosta" : "Import a forest from CSV"}
            </span>
          )}
        </div>

        {status === "selected" && (
          <button
            onClick={handleUpload}
            className="flex items-center justify-center px-3 py-1 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700 transition-colors shrink-0"
          >
            {language === "fi" ? "Lataa" : "Upload"}
          </button>
        )}

        {(status === "done" || status === "error") && (
          <button
            onClick={handleClear}
            className="flex items-center justify-center w-6 h-6 rounded-lg hover:bg-gray-200/60 dark:hover:bg-gray-700/60 text-gray-400 dark:text-gray-500 transition-colors shrink-0"
            title={language === "fi" ? "Tyhjennä" : "Clear"}
            aria-label={language === "fi" ? "Tyhjennä" : "Clear"}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
