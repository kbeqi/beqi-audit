import { createClient } from "@/app/actions";
import { Card, buttonCls, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function NewClientPage() {
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">Add client</h1>
      <Card>
        <form action={createClient} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Client name</span>
            <input name="name" required className={inputCls} placeholder="Acme Health" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Notes</span>
            <textarea name="notes" rows={3} className={inputCls} placeholder="Retainer scope, contacts, anything the team should know" />
          </label>
          <button className={buttonCls}>Create client</button>
        </form>
        <p className="mt-3 text-xs text-zinc-500">Next step after creating: connect the client&apos;s Webflow workspace. Each workspace needs its own authorization.</p>
      </Card>
    </div>
  );
}
