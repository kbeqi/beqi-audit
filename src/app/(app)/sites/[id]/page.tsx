import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSignedIn } from "@/app/gate";

export const dynamic = "force-dynamic";

// Each client has one site, so the site's page is the client's hub. Old links
// (emails, bookmarks) land here and are sent on.
export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSignedIn(`/sites/${id}`);
  const db = await getDb();
  const site = await db.query.sites.findFirst({ where: eq(schema.sites.id, id), columns: { clientId: true } });
  if (!site) notFound();
  redirect(`/clients/${site.clientId}`);
}
