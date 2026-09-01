"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Panel, StatusPill } from "@/components/demo/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  loadAdminPrivacyRequests,
  updateAdminPrivacyRequest,
  type PrivacyRequestRead,
} from "@/lib/privacy/client";
import type { PrivacyErasureBlocker, PrivacyRequest } from "@/lib/privacy/types";

const BLOCKER_COPY: Record<PrivacyErasureBlocker, string> = {
  active_subscription: "The consumer still has an active subscription.",
  billing_cancellation_required: "The local billing record has not reached cancelled.",
  enrollment_cancellation_required: "The enrollment must be cancelled first.",
  monitoring_provider_cleanup_pending: "The monitoring provider member has not been closed and cleared.",
  provider_cancellation_pending: "Provider subscription cancellation is missing or unconfirmed.",
};

function date(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

function tone(status: PrivacyRequest["status"]): "info" | "neutral" | "success" | "warning" {
  if (status === "completed") return "success";
  if (status === "submitted") return "warning";
  if (status === "in_review") return "info";
  return "neutral";
}

function statusLabel(status: PrivacyRequest["status"]): string {
  return status === "in_review" ? "In review" : status[0].toUpperCase() + status.slice(1);
}

export function AdminPrivacyRequests() {
  const [read, setRead] = useState<PrivacyRequestRead | "loading">("loading");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void loadAdminPrivacyRequests().then((result) => { if (active) setRead(result); });
    return () => { active = false; };
  }, []);

  async function act(request: PrivacyRequest, action: "review" | "deny" | "complete") {
    if (pendingId) return;
    const payload = action === "review"
      ? { action: "review" as const }
      : action === "deny"
        ? { action: "deny" as const, reason: reasons[request.id] ?? "" }
        : { action: "complete" as const, completionNote: request.kind === "access" ? notes[request.id] ?? "" : null };
    setPendingId(request.id);
    setErrors((current) => ({ ...current, [request.id]: "" }));
    const result = await updateAdminPrivacyRequest(request.id, payload);
    setPendingId(null);
    if (!result.ok) {
      const blockerText = result.blockers.map((blocker) => BLOCKER_COPY[blocker]).join(" ");
      setErrors((current) => ({
        ...current,
        [request.id]: blockerText || (result.code === "invalid_request"
          ? "Enter the required review note or denial reason."
          : "The action could not be verified. No completion is recorded."),
      }));
      return;
    }
    setRead((current) => Array.isArray(current)
      ? Object.freeze(current.map((item) => item.id === result.request.id ? result.request : item))
      : Object.freeze([result.request]));
  }

  return (
    <Panel
      title="Consumer privacy requests"
      description="Review access and deletion requests. Access completion records manual delivery; deletion completion removes private files and disables auth only after every provider gate is already clear."
    >
      {read === "loading" ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />Loading privacy requests…</p> : null}
      {read === null ? <p className="text-sm text-muted-foreground" role="status">The privacy workflow is unavailable in this environment.</p> : null}
      {read === "failed" ? <p className="text-sm text-destructive" role="alert">Privacy requests could not be loaded. Reload before taking an action.</p> : null}
      {Array.isArray(read) && read.length === 0 ? <p className="text-sm text-muted-foreground">No consumer privacy requests have been submitted.</p> : null}
      {Array.isArray(read) ? <div className="space-y-3">{read.map((request) => (
        <article className="rounded-lg border border-border p-4" key={request.id}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{request.consumerName} · {request.kind === "access" ? "Data access" : "Data deletion"}</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">{request.consumerEmail} · {request.organizationName}</p>
              <p className="mt-1 text-xs text-muted-foreground">Submitted {date(request.submittedAt)}</p>
            </div>
            <StatusPill tone={tone(request.status)}>{statusLabel(request.status)}</StatusPill>
          </div>
          {request.status === "submitted" ? (
            <div className="mt-4 flex justify-end border-t border-border pt-3">
              <Button className="min-h-11" disabled={pendingId !== null} onClick={() => { void act(request, "review"); }} size="sm">
                {pendingId === request.id ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}Begin review
              </Button>
            </div>
          ) : null}
          {request.status === "in_review" ? (
            <div className="mt-4 grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
              <div>
                <label className="text-xs font-semibold" htmlFor={`privacy-denial-${request.id}`}>Denial reason</label>
                <Textarea id={`privacy-denial-${request.id}`} maxLength={500} onChange={(event) => setReasons((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Required before denying" value={reasons[request.id] ?? ""} />
                <Button className="mt-2 min-h-11" disabled={pendingId !== null || !(reasons[request.id] ?? "").trim()} onClick={() => { void act(request, "deny"); }} size="sm" variant="outline">Deny request</Button>
              </div>
              <div>
                {request.kind === "access" ? (
                  <>
                    <label className="text-xs font-semibold" htmlFor={`privacy-completion-${request.id}`}>Delivery record</label>
                    <Textarea id={`privacy-completion-${request.id}`} maxLength={1000} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="How and where the data copy was delivered" value={notes[request.id] ?? ""} />
                  </>
                ) : <p className="text-xs leading-5 text-muted-foreground">This action does not cancel billing or monitoring providers. It fails closed until those cancellations are confirmed, then removes client storage, verifies auth disablement, and pseudonymizes direct PII.</p>}
                <Button className="mt-2 min-h-11" disabled={pendingId !== null || (request.kind === "access" && !(notes[request.id] ?? "").trim())} onClick={() => { void act(request, "complete"); }} size="sm">
                  {pendingId === request.id ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
                  {request.kind === "access" ? "Record delivery" : "Complete verified erasure"}
                </Button>
              </div>
            </div>
          ) : null}
          {request.denialReason ? <p className="mt-3 text-xs leading-5 text-muted-foreground">Denied: {request.denialReason}</p> : null}
          {request.completionNote ? <p className="mt-3 text-xs leading-5 text-muted-foreground">Completed: {request.completionNote}</p> : null}
          {errors[request.id] ? <p className="mt-3 text-xs leading-5 text-destructive" role="alert">{errors[request.id]}</p> : null}
        </article>
      ))}</div> : null}
    </Panel>
  );
}
