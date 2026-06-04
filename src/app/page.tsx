"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import ThemeToggle from "@/components/shared/ThemeToggle";
import LanguageToggle from "@/components/shared/LanguageToggle";
import { useForestStore } from "@/lib/store";
import { appName, landingLabels } from "@/lib/i18n";

export default function Home() {
  const language = useForestStore((s) => s.language) ?? "en";
  const L = landingLabels(language);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-green-50 to-white dark:from-green-950 dark:to-gray-950">
      {/* Header */}
      <header className="flex items-center justify-end gap-1 px-4 py-3">
        <LanguageToggle />
        <ThemeToggle />
      </header>

      {/* Hero */}
      <main className="flex flex-col items-center text-center flex-1 px-4 pt-12 pb-16 max-w-2xl mx-auto">
        {/* Tree icon */}
        <div className="mb-6 text-6xl">🌲</div>

        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-5xl">
          {mounted ? appName(language) : "ForestChat"}
        </h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-400 max-w-md">
          {mounted ? L.tagline : "AI-powered forest management — visualize and manage your forest plan through conversation."}
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-md">
          {mounted ? L.subtagline : "Enter your Finnish property ID and the app automatically loads your forest data. Ask the AI to generate a 20-year plan, then refine it through chat."}
        </p>

        <div className="mt-8 flex gap-4">
          <Link
            href="/auth/register"
            className="rounded-full bg-green-700 dark:bg-green-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-green-800 dark:hover:bg-green-700 transition-colors"
          >
            {mounted ? L.getStarted : "Get Started"}
          </Link>
          <Link
            href="/auth/login"
            className="rounded-full border border-gray-300 dark:border-gray-600 px-6 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {mounted ? L.logIn : "Log in"}
          </Link>
        </div>

        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          {mounted ? L.alreadyHaveAccount : "Already have an account?"}{" "}
          <Link
            href="/auth/login"
            className="font-medium text-green-700 dark:text-green-400 hover:underline"
          >
            {mounted ? L.logIn : "Log in"}
          </Link>
        </p>

        {/* Feature summary */}
        <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-2xl">
          {(["map", "aiChat", "charts", "stands"] as const).map((key) => {
            const f = L.features[key];
            const emoji = { map: "🗺️", aiChat: "🤖", charts: "📊", stands: "🌲" }[key];
            return (
              <div
                key={key}
                className="flex flex-col items-center text-center p-3 rounded-lg hover:bg-green-50/50 dark:hover:bg-green-900/20 transition-colors"
              >
                <span className="text-2xl mb-1">{emoji}</span>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {mounted ? f.title : key === "aiChat" ? "AI Chat" : key.charAt(0).toUpperCase() + key.slice(1)}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {mounted ? f.desc : ""}
                </p>
              </div>
            );
          })}
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center pb-6 text-xs text-gray-400 dark:text-gray-500">
        <a
          href="https://github.com/pasihokkanen/ForestChat"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-green-700 dark:hover:text-green-400 transition-colors"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}
