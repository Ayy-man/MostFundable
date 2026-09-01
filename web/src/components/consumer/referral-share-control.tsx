"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type State = "idle" | "busy" | "copied" | "failed";

export function ReferralShareControl() {
  const [state, setState] = useState<State>("idle");

  async function copyReferralLink() {
    if (state === "busy") return;
    setState("busy");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      const response = await fetch("/api/referrals", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const result = await response.json() as { url?: unknown };
      if (!response.ok || typeof result.url !== "string") throw new Error("referral unavailable");
      await navigator.clipboard.writeText(result.url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div>
      <Button disabled={state === "busy"} onClick={copyReferralLink} type="button" variant="outline">
        Copy referral link
      </Button>
      <span aria-live="polite" className="sr-only">
        {state === "copied"
          ? "Referral link copied"
          : state === "failed"
            ? "Referral link unavailable"
            : ""}
      </span>
    </div>
  );
}
