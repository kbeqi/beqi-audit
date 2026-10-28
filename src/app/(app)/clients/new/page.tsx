import { requireSignedIn } from "@/app/gate";
import { createClient } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, PageHeader, btnPrimary, inputCls, labelCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  await requireSignedIn("/clients/new");
  return (
    <div className="max-w-lg">
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
