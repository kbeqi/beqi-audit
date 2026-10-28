import { requireSignedIn } from "@/app/gate";
import type { Metadata } from "next";
import { createClient } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, Crumbs, PageHeader, btnPrimary, inputCls, labelCls } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add client" };

export default async function NewClientPage() {
  await requireSignedIn("/clients/new");
  return (
    <div className="max-w-lg space-y-4">
      <Crumbs items={[{ href: "/clients", label: "Clients" }, { label: "Add client" }]} />
      <PageHeader title="Add client" description="Create the client, then connect their Webflow workspace. Sites are imported automatically." />
      <Card className="p-5">
        <form action={createClient} className="space-y-4">
          <div>
            <label htmlFor="name" className={labelCls}>
              Client name
            </label>
            <input id="name" name="name" required className={inputCls} placeholder="Acme Health" autoFocus />
          </div>
          <div>
            <label htmlFor="notes" className={labelCls}>
              Notes
            </label>
            <textarea id="notes" name="notes" rows={3} className={inputCls} placeholder="Retainer scope, contacts, anything the team should know" />
          </div>
          <SubmitButton className={btnPrimary} pendingLabel="Creating…">Create client</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
