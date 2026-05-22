import ForestList from "@/components/forest/ForestList";
import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">My Forests</h1>
        <Link
          href="/forest/new"
          className="rounded-md bg-green-700 dark:bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 dark:hover:bg-green-700 transition-colors"
        >
          + Import Forest
        </Link>
      </div>
      <ForestList />
    </div>
  );
}