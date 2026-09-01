"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";

import { WorkspaceSection } from "@/components/consumer/consumer-kit";
import { Button } from "@/components/ui/button";
import {
  loadConsumerPrivacyRequests,
  submitConsumerPrivacyRequest,
  type PrivacyRequestRead,
} from "@/lib/privacy/client";
import type { PrivacyRequest, PrivacyRequestKind } from "@/lib/privacy/types";

function date(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

function label(request: PrivacyRequest): string {
  if (request.status === "in_review") return "In review";
  return request.status[0].toUpperCase() + request.status.slice(1);
}

export function ConsumerPrivacyRequests() {
  const [read, setRead] = useState<PrivacyRequestRead | "loading">("loading");
  const [pending, setPending] = useState<PrivacyRequestKind | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    void loadConsumerPrivacyRequests().then((result) => { if (active) setRead(result); });
    return () => { active = false; };
  }, []);

  const requests = Array.isArray(read) ? read : [];
  const open = new Set(
    requests
      .filter((request) => request.status === "submitted" || request.status === "in_review")
      .map((request) => request.kind),
  );

  async function submit(kind: PrivacyRequestKind) {
    if (pending || open.has(kind)) return;
    setPending(kind);
    setNotice(null);
    const result = await submitConsumerPrivacyRequest(kind);
    setPending(null);
    if (!result.ok) {
      setNotice({ error: true, text: "The request could not be verified as stored. Nothing is shown as submitted." });
      return;
    }
    setRead((current) => Array.isArray(current)
      ? Object.freeze([result.request, ...current.filter((request) => request.id !== result.request.id)])
      : Object.freeze([result.request]));
    setNotice({ error: false, text: `${kind === "access" ? "Data access" : "Deletion"} request submitted.` });
  }

  return (
    <WorkspaceSection
      description="Submit and track a request for a copy of your data or deletion of eligible account data."
      title="Privacy requests"
    >
      <div className="rounded-[8px] bg-[var(--consumer-canvas)] p-3 text-xs leading-5 text-muted-foreground">
        <div className="flex items-start gap-2">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>
            A deletion request does not cancel billing or provider services automatically. Completion waits for confirmed cancellation and removes private files and direct account PII, while legally necessary audit, payment, and consent records remain.
          </p>
        </div>
      </div>
      {notice ? <p className={`mt-3 text-xs leading-5 ${notice.error ? "text-[var(--consumer-negative)]" : "text-[var(--consumer-positive)]"}`} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}
      {read === "failed" ? <p className="mt-3 text-xs leading-5 text-[var(--consumer-negative)]" role="alert">Privacy requests could not be loaded. Reload before submitting so you do not create a duplicate.</p> : null}
      {read === null ? <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">Privacy requests are unavailable in this environment.</p> : null}
      {read === "loading" ? <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" role="status"><LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />Loading requests…</p> : null}
      {Array.isArray(read) ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button className="min-h-11" disabled={pending !== null || open.has("access")} onClick={() => { void submit("access"); }} variant="outline">
              {pending === "access" ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {open.has("access") ? "Access request open" : "Request my data"}
            </Button>
            <Button className="min-h-11" disabled={pending !== null || open.has("deletion")} onClick={() => { void submit("deletion"); }} variant="outline">
              {pending === "deletion" ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {open.has("deletion") ? "Deletion request open" : "Request deletion"}
            </Button>
          </div>
          <div className="mt-4 divide-y divide-[var(--consumer-border)]">
            {requests.length === 0 ? <p className="py-2 text-xs text-muted-foreground">No privacy requests have been submitted.</p> : requests.map((request) => (
              <div className="py-3 first:pt-0 last:pb-0" key={request.id}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{request.kind === "access" ? "Data access" : "Data deletion"}</p>
                  <span className="rounded-full border border-[var(--consumer-border)] px-2 py-1 text-[0.65rem] font-semibold">{label(request)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Submitted {date(request.submittedAt)}</p>
                {request.denialReason ? <p className="mt-2 text-xs leading-5 text-[var(--consumer-negative)]">Reason: {request.denialReason}</p> : null}
                {request.completionNote ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{request.completionNote}</p> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </WorkspaceSection>
  );
}
