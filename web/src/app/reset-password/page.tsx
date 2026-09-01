import type { Metadata } from "next";

import { ResetPasswordForm } from "@/app/reset-password/reset-form";

export const metadata: Metadata = {
  description: "Choose a new password for your MostFundable account.",
  title: "Choose a new password | MostFundable",
};

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm" data-motion-route>
        <h1 className="text-lg font-semibold text-foreground">Choose a new password</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          This form works only after opening the one-time link in your recovery email.
        </p>
        <div className="mt-6"><ResetPasswordForm /></div>
      </div>
    </main>
  );
}
