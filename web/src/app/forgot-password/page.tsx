import type { Metadata } from "next";

import { PasswordResetRequestForm } from "@/app/forgot-password/request-form";

export const metadata: Metadata = {
  description: "Request a password reset for your MostFundable account.",
  title: "Reset password | MostFundable",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm" data-motion-route>
        <h1 className="text-lg font-semibold text-foreground">Reset your password</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Enter the address on your account and we’ll email a one-time recovery link.
        </p>
        <div className="mt-6"><PasswordResetRequestForm /></div>
      </div>
    </main>
  );
}
