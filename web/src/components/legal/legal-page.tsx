import type { ReactNode } from "react";

export function LegalPage({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 shadow-sm sm:p-10">
        <a className="text-sm font-medium text-primary-ink underline-offset-4 hover:underline" href="/sign-in">
          MostFundable
        </a>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated September 1, 2026</p>
        <div className="mt-8 space-y-8 text-sm leading-7 text-foreground [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_p+p]:mt-3 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2">
          {children}
        </div>
        <nav className="mt-10 flex gap-5 border-t border-border pt-6 text-sm" aria-label="Legal pages">
          <a className="text-primary-ink underline-offset-4 hover:underline" href="/terms">Terms</a>
          <a className="text-primary-ink underline-offset-4 hover:underline" href="/privacy">Privacy</a>
          <a className="text-primary-ink underline-offset-4 hover:underline" href="/sign-in">Sign in</a>
        </nav>
      </article>
    </main>
  );
}
