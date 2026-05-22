import ForestView from "@/components/forest/ForestView";

export default async function ForestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ForestView forestId={id} />;
}
