"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Field({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div>
      <Label className="text-xs font-semibold" htmlFor={htmlFor}>
        {label}
      </Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/sign-in", {
        body: JSON.stringify({ email, password }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }

      setError("Those sign-in details were not accepted.");
    } catch {
      setError("Sign-in could not be completed. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={handleSubmit}>
      <Field htmlFor="sign-in-email" label="Email">
        <Input
          autoComplete="email"
          className="min-h-11"
          id="sign-in-email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </Field>
      <Field htmlFor="sign-in-password" label="Password">
        <Input
          autoComplete="current-password"
          className="min-h-11"
          id="sign-in-password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </Field>
      <div className="-mt-3 text-right">
        <a
          className="text-xs font-medium text-primary-ink underline-offset-4 hover:underline"
          href="/forgot-password"
        >
          Forgot password?
        </a>
      </div>
      {error === null ? null : (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button className="min-h-11" disabled={submitting} type="submit">
        {submitting ? "Signing in" : "Sign in"}
      </Button>
      <p className="text-center text-xs leading-5 text-muted-foreground">
        By continuing, you agree to the <a className="underline underline-offset-4" href="/terms">Terms</a>{" "}
        and acknowledge the <a className="underline underline-offset-4" href="/privacy">Privacy Policy</a>.
      </p>
    </form>
  );
}
