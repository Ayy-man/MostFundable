"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/request-password-reset", {
        body: JSON.stringify({ email }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("request failed");
      setSent(true);
    } catch {
      setError("The recovery email could not be requested. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4" role="status">
        <p className="text-sm leading-6 text-foreground">
          If an account exists for that address, a password-reset link is on its way.
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          The link expires and can be used once. Check spam before requesting another.
        </p>
        <a className="text-sm font-medium text-primary-ink underline underline-offset-4" href="/sign-in">
          Return to sign in
        </a>
      </div>
    );
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={submit}>
      <div>
        <Label className="text-xs font-semibold" htmlFor="recovery-email">Email</Label>
        <Input
          autoComplete="email"
          className="mt-2 min-h-11"
          id="recovery-email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>
      {error === null ? null : <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button className="min-h-11" disabled={submitting} type="submit">
        {submitting ? "Requesting link" : "Email reset link"}
      </Button>
      <a className="text-center text-xs font-medium text-primary-ink underline-offset-4 hover:underline" href="/sign-in">
        Return to sign in
      </a>
    </form>
  );
}
