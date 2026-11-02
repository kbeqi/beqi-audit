import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The clients list is the team's home now.
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  redirect(deleted ? `/?deleted=${encodeURIComponent(deleted)}` : "/");
}
