import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { currentActorOrNull } from "@/lib/auth";
import { getEnv } from "@/lib/env";

// Serves a client's logo from KV. Signed-in only (logos are client assets).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentActorOrNull())) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, id), columns: { logoKey: true, logoUpdatedAt: true } });
  if (!client?.logoKey) return new NextResponse(null, { status: 404 });
  const env = await getEnv();
  const { value, metadata } = await env.AUDIT_STORE.getWithMetadata<{ contentType?: string }>(client.logoKey, "arrayBuffer");
  if (!value) return new NextResponse(null, { status: 404 });
  return new NextResponse(value, {
    headers: {
      "content-type": metadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=3600",
      "content-security-policy": "sandbox", // an uploaded SVG must never run scripts
    },
  });
}
