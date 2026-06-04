import UserMenu from "@/components/auth/UserMenu";
import ThemeToggle from "@/components/shared/ThemeToggle";
import LanguageToggle from "@/components/shared/LanguageToggle";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import Link from "next/link";

export default function ForestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen">
        <header className="h-12 border-b bg-white dark:bg-gray-900 flex items-center justify-between px-4 shrink-0">
          <Link
            href="/dashboard"
            className="font-semibold text-gray-900 dark:text-gray-100 hover:text-green-700 dark:hover:text-green-400 transition-colors"
          >
            ForestChat
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LanguageToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </ErrorBoundary>
  );
}