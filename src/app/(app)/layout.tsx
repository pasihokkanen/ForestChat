export default function ForestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen">
      <header className="h-12 border-b bg-white flex items-center px-4 shrink-0">
        <h1 className="font-semibold text-gray-900">ForestChat</h1>
        {/* Auth placeholder — Phase 2 */}
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
