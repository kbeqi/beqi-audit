import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sharedReport } from "@/lib/queries";
import { Report } from "@/components/report";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const data = await sharedReport(token);
  return {
    title: data ? `Audit of ${data.site.name}` : "Report",
    robots: { index: false, follow: false },
  };
}

// A read-only audit report for anyone with the link. No sign-in, no actions.
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await sharedReport(token);
  if (!data) notFound();
  const { run, site, client, findings, previous, fixesDone, metrics, aiAnswers } = data;
  return <Report run={run} siteName={site.name} baseUrl={site.baseUrl} clientName={client?.name ?? null} previous={previous} findings={findings} fixesDone={fixesDone} metrics={metrics} aiAnswers={aiAnswers} />;
}
