import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// One site per client: the overview is the site. Old links land here.
export default async function ClientSites({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/clients/${id}`);
}
