import { Clock3, LogOut, ShieldCheck } from "lucide-react";

export function ConsumerPendingPage() {
  return (
    <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-8">
      <section className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm sm:p-9">
        <div className="flex size-11 items-center justify-center rounded-lg bg-muted">
          <Clock3 aria-hidden className="size-5" />
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Account setup
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Your workspace is being prepared.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Your sign-in is active, but no client workspace has been assigned to this account yet.
          You can return here safely while the intake team completes that setup.
        </p>
        <div className="mt-7 flex gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm leading-6">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>No monitoring, analysis, or billing action starts from this pending page.</p>
        </div>
        <div className="mt-7 flex justify-end">
          <form action="/api/auth/sign-out" method="post">
            <button className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted" type="submit">
              <LogOut aria-hidden className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
