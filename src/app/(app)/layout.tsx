"use client";

import { useState, useEffect } from "react";
import UserMenu from "@/components/auth/UserMenu";
import ThemeToggle from "@/components/shared/ThemeToggle";
import LanguageToggle from "@/components/shared/LanguageToggle";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import GlobalChatPanel from "@/components/chat/GlobalChatPanel";
import { useForestStore } from "@/lib/store";
import { useUserForests } from "@/lib/hooks/use-user-forests";
import { appName } from "@/lib/i18n";
import Link from "next/link";

export default function ForestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const language = useForestStore((s) => s.language) ?? "en";
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { forests } = useUserForests();
  const setForests = useForestStore((s) => s.setForests);
  useEffect(() => {
    if (forests.length > 0) setForests(forests);
  }, [forests, setForests]);

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen">
        <header className="h-12 border-b bg-white dark:bg-gray-900 flex items-center justify-between px-4 shrink-0">
          <Link
            href="/dashboard"
            className="font-semibold text-gray-900 dark:text-gray-100 hover:text-green-700 dark:hover:text-green-400 transition-colors"
          >
            {mounted ? appName(language) : "ForestChat"}
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LanguageToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-hidden flex flex-row">
          <div className="flex-1 min-w-0">{children}</div>
          <div className="w-[400px] shrink-0 border-l border-gray-200 dark:border-gray-700">
            <GlobalChatPanel />
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}