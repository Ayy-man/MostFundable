"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm() {
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (password.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/update-password", {
        body: JSON.stringify({ password }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const message = response.status === 401
          ? "This recovery link has expired. Request a new one."
          : "The password could not be updated. Try again.";
        setError(message);
        return;
      }
      // The completed auth mutation needs a full document navigation so server session state reloads.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch {
      setError("The password could not be updated. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={submit}>
      <div>
        <Label className="text-xs font-semibold" htmlFor="new-password">New password</Label>
        <Input autoComplete="new-password" className="mt-2 min-h-11" id="new-password" minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
      </div>
      <div>
        <Label className="text-xs font-semibold" htmlFor="confirm-password">Confirm password</Label>
        <Input autoComplete="new-password" className="mt-2 min-h-11" id="confirm-password" minLength={12} onChange={(event) => setConfirm(event.target.value)} required type="password" value={confirm} />
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Use at least 12 characters. A password manager is recommended.</p>
      {error === null ? null : <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button className="min-h-11" disabled={submitting} type="submit">
        {submitting ? "Updating password" : "Update password"}
      </Button>
      <a className="text-center text-xs font-medium text-primary-ink underline-offset-4 hover:underline" href="/forgot-password">
        Request a new link
      </a>
    </form>
  );
}
