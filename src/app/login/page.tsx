import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requestSignIn } from "@/app/auth-actions";
import { currentActorOrNull } from "@/lib/auth";
import { SubmitButton } from "@/components/submit-button";
import { btnPrimary, inputCls, labelCls } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string; next?: string }> }) {
  const { sent, error, next } = await searchParams;
  if (await currentActorOrNull()) redirect(next && next.startsWith("/") ? next : "/");

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rounded-xl border border-line bg-surface p-6">
        <h1 className="text-lg font-semibold text-ink">Sign in</h1>
        {sent ? (
          <>
            <p className="mt-2 text-sm text-ink-2">
              If <span className="font-medium text-ink">{sent}</span> is on the team, a sign-in link is on its way. It works once and expires in 15 minutes.
            </p>
            <p className="mt-3 text-xs text-ink-3">Nothing arrived? Check spam, or ask an admin to add you on the Team page.</p>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-2">Enter your work email and we&apos;ll send you a one-time sign-in link.</p>
            {error && <p className="mt-3 rounded-md px-3 py-2 text-sm tone-critical">{decodeURIComponent(error)}</p>}
            <form action={requestSignIn} className="mt-4 space-y-3">
              {next && <input type="hidden" name="next" value={next} />}
              <div>
                <label htmlFor="email" className={labelCls}>
                  Email
                </label>
                <input id="email" name="email" type="email" required autoFocus autoComplete="email" className={inputCls} placeholder="you@beqi.co" />
              </div>
              <SubmitButton className={`${btnPrimary} w-full`} pendingLabel="Sending link…">
                Email me a sign-in link
              </SubmitButton>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
