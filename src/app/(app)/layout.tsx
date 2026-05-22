import UserMenu from "@/components/auth/UserMenu";
import Link from "next/link";

export default function ForestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen">
      <header className="h-12 border-b bg-white flex items-center justify-between px-4 shrink-0">
        <Link
          href="/dashboard"
          className="font-semibold text-gray-900 hover:text-green-700 transition-colors"
        >
          ForestChat
        </Link>
        <UserMenu />
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
