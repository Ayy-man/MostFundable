"use client";

import { useEffect, useMemo, useState } from "react";

import { StatusPill } from "@/components/demo/shared";
import { BrandSelect, type BrandSelectOption } from "@/components/ui/brand-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  Application,
  ApplicationConsumerStatus,
  ApplicationOperatorStatus,
  ApplicationVisibility,
  OutcomeKind,
} from "@/lib/applications/types";
import {
  createClientApplication,
  isApplicationDate,
  parseDollarInput,
  readApplicationLenders,
  readClientApplications,
  recordClientApplicationOutcome,
  updateClientApplication,
  type ApplicationLendersRead,
  type ApplicationsRead,
} from "@/lib/operator/applications.client";

type PipelineRead =
  | { readonly clientId: string; readonly state: "loading" }
  | ({ readonly clientId: string } & ApplicationsRead);

type LendersRead = { readonly state: "loading" } | ApplicationLendersRead;

interface CreateDraft {
  readonly amount: string;
  readonly bankRef: string;
  readonly clientId: string;
}

interface EditDraft {
  readonly amount: string;
  readonly applicationId: string;
  readonly clientId: string;
  readonly consumerStatus: ApplicationConsumerStatus;
  readonly operatorStatus: ApplicationOperatorStatus;
  readonly visibility: ApplicationVisibility;
}

interface OutcomeDraft {
  readonly amount: string;
  readonly applicationId: string;
  readonly clientId: string;
  readonly decidedOn: string;
  readonly kind: OutcomeKind;
}

const OPERATOR_STATUS_OPTIONS = [
  { label: "Waiting", value: "wait" },
  { label: "Action needed", value: "todo" },
] as const;

const CONSUMER_STATUS_OPTIONS = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Denied", value: "denied" },
] as const;

const VISIBILITY_OPTIONS = [
  { label: "Inherit client setting", value: "inherit" },
  { label: "Show status and details", value: "details" },
  { label: "Show status only", value: "status_only" },
] as const;

const OUTCOME_OPTIONS = [
  { label: "Approved", value: "approved" },
  { label: "Denied", value: "denied" },
  { label: "Withdrawn", value: "withdrawn" },
] as const;

const NO_APPLICATIONS: readonly Application[] = [];

function formatAmount(cents: number | null) {
  if (cents === null) return "Amount not recorded";
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(cents / 100);
}

function inputAmount(cents: number | null) {
  return cents === null ? "" : String(cents / 100);
}

function statusTone(status: Application["consumerStatus"]) {
  if (status === "approved") return "success" as const;
  if (status === "denied") return "danger" as const;
  return "warning" as const;
}

function statusLabel(status: ApplicationConsumerStatus) {
  return CONSUMER_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function operatorStatusLabel(status: ApplicationOperatorStatus) {
  return OPERATOR_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function visibilityLabel(visibility: ApplicationVisibility) {
  return VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.label ?? visibility;
}

function displayBank(bankRef: string) {
  return bankRef
    .replaceAll(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function todayInput() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function TrackerFundingPipeline({
  clientId,
  enabled,
}: {
  clientId: string;
  enabled: boolean;
}) {
  const [read, setRead] = useState<PipelineRead>(() => ({ clientId, state: "loading" }));
  const [lendersRead, setLendersRead] = useState<LendersRead>({ state: "loading" });
  const [reloadVersion, setReloadVersion] = useState(0);
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [outcomeDraft, setOutcomeDraft] = useState<OutcomeDraft | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ clientId: string; message: string } | null>(null);
  const [notice, setNotice] = useState<{ clientId: string; message: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setRead({ clientId, state: "loading" });
      setLendersRead({ state: "loading" });
    });
    void readClientApplications(clientId).then((result) => {
      if (active) setRead({ ...result, clientId });
    });
    void readApplicationLenders().then((result) => {
      if (active) setLendersRead(result);
    });
    return () => {
      active = false;
    };
  }, [clientId, enabled, reloadVersion]);

  const visibleRead: PipelineRead | { state: "disabled" } = !enabled
    ? { state: "disabled" }
    : read.clientId === clientId
      ? read
      : { clientId, state: "loading" };
  const applications = visibleRead.state === "ready"
    ? visibleRead.applications
    : NO_APPLICATIONS;
  const activeCreate = visibleRead.state === "ready" && createDraft?.clientId === clientId
    ? createDraft
    : null;
  const activeEdit = visibleRead.state === "ready" && editDraft?.clientId === clientId
    ? editDraft
    : null;
  const activeOutcome = visibleRead.state === "ready" && outcomeDraft?.clientId === clientId
    ? outcomeDraft
    : null;
  const currentProblem = problem?.clientId === clientId ? problem.message : null;
  const currentNotice = notice?.clientId === clientId ? notice.message : null;

  const lenderByRef = useMemo(() => {
    const lenders = lendersRead.state === "ready" ? lendersRead.lenders : [];
    return new Map(lenders.map((lender) => [lender.bankRef, lender]));
  }, [lendersRead]);
  const lenderOptions = useMemo<readonly BrandSelectOption[]>(() => {
    if (lendersRead.state !== "ready") return [];
    const used = new Set(applications.map((application) => application.bankRef));
    return lendersRead.lenders.map((lender) => ({
      description:
        lender.products.length > 0
          ? lender.products.join(" · ")
          : "No product list recorded",
      disabled: used.has(lender.bankRef),
      label: used.has(lender.bankRef) ? `${lender.name} · already added` : lender.name,
      value: lender.bankRef,
    }));
  }, [applications, lendersRead]);

  async function refreshApplications(targetClientId: string) {
    setRead({ clientId: targetClientId, state: "loading" });
    const result = await readClientApplications(targetClientId);
    setRead({ ...result, clientId: targetClientId });
  }

  function clearMessages() {
    setProblem(null);
    setNotice(null);
  }

  function startCreate() {
    clearMessages();
    setEditDraft(null);
    setOutcomeDraft(null);
    setCreateDraft({ amount: "", bankRef: "", clientId });
  }

  function startEdit(application: Application) {
    clearMessages();
    setCreateDraft(null);
    setOutcomeDraft(null);
    setEditDraft({
      amount: inputAmount(application.amountCents),
      applicationId: application.id,
      clientId,
      consumerStatus: application.consumerStatus,
      operatorStatus: application.operatorStatus,
      visibility: application.visibility,
    });
  }

  function startOutcome(application: Application) {
    clearMessages();
    setCreateDraft(null);
    setEditDraft(null);
    setOutcomeDraft({
      amount: "",
      applicationId: application.id,
      clientId,
      decidedOn: todayInput(),
      kind: "approved",
    });
  }

  async function submitCreate() {
    if (activeCreate === null) return;
    clearMessages();
    if (activeCreate.bankRef === "") {
      setProblem({ clientId, message: "Choose a lender before creating the application." });
      return;
    }
    const amount = parseDollarInput(activeCreate.amount, "optional");
    if (!amount.ok) {
      setProblem({ clientId, message: amount.message });
      return;
    }
    setPending("create");
    const result = await createClientApplication({
      amountCents: amount.cents,
      bankRef: activeCreate.bankRef,
      clientId,
    });
    if (!result.ok) {
      setPending(null);
      setProblem({ clientId, message: result.message });
      return;
    }
    setCreateDraft(null);
    setNotice({ clientId, message: "Application created from the stored lender record." });
    await refreshApplications(clientId);
    setPending(null);
  }

  async function submitEdit() {
    if (activeEdit === null) return;
    clearMessages();
    const amount = parseDollarInput(activeEdit.amount, "optional");
    if (!amount.ok) {
      setProblem({ clientId, message: amount.message });
      return;
    }
    setPending(`edit:${activeEdit.applicationId}`);
    const result = await updateClientApplication(activeEdit.applicationId, {
      amountCents: amount.cents,
      consumerStatus: activeEdit.consumerStatus,
      operatorStatus: activeEdit.operatorStatus,
      visibility: activeEdit.visibility,
    });
    if (!result.ok) {
      setPending(null);
      setProblem({ clientId, message: result.message });
      return;
    }
    setEditDraft(null);
    setNotice({ clientId, message: "Application changes saved." });
    await refreshApplications(clientId);
    setPending(null);
  }

  async function submitOutcome() {
    if (activeOutcome === null) return;
    clearMessages();
    if (!isApplicationDate(activeOutcome.decidedOn)) {
      setProblem({ clientId, message: "Choose a valid decision date." });
      return;
    }
    const amount = parseDollarInput(
      activeOutcome.kind === "approved" ? activeOutcome.amount : "",
      activeOutcome.kind === "approved" ? "positive" : "optional",
    );
    if (!amount.ok) {
      setProblem({ clientId, message: amount.message });
      return;
    }
    setPending(`outcome:${activeOutcome.applicationId}`);
    const result = await recordClientApplicationOutcome(
      activeOutcome.applicationId,
      {
        amountCents: activeOutcome.kind === "approved" ? amount.cents : null,
        decidedOn: activeOutcome.decidedOn,
        kind: activeOutcome.kind,
      },
    );
    if (!result.ok) {
      setPending(null);
      setProblem({ clientId, message: result.message });
      return;
    }
    setOutcomeDraft(null);
    setNotice({
      clientId,
      message: `${OUTCOME_OPTIONS.find((option) => option.value === result.value.kind)?.label ?? "Funding"} outcome recorded.`,
    });
    await refreshApplications(clientId);
    setPending(null);
  }

  const createUnavailable =
    lendersRead.state !== "ready" || lendersRead.lenders.length === 0;

  return (
    <section className="mt-6 border-t border-border pt-5" aria-labelledby="funding-pipeline-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" id="funding-pipeline-title">
            Funding plan and pipeline
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Create lender applications, maintain their shared status, and record funding outcomes.
          </p>
        </div>
        {visibleRead.state === "ready" ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {applications.length} {applications.length === 1 ? "application" : "applications"}
            </span>
            <Button
              disabled={createUnavailable || pending !== null}
              onClick={startCreate}
              size="sm"
              title={createUnavailable ? "The lender catalog must be available before creating an application." : undefined}
              variant="outline"
            >
              Add application
            </Button>
          </div>
        ) : null}
      </div>

      {currentProblem ? (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {currentProblem}
        </p>
      ) : null}
      {currentNotice ? (
        <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" role="status">
          {currentNotice}
        </p>
      ) : null}

      {visibleRead.state === "ready" && lendersRead.state === "disabled" ? (
        <p className="mt-4 text-xs leading-5 text-muted-foreground" role="status">
          The lender catalog is not enabled. Existing applications remain editable, but a new application needs a stored lender.
        </p>
      ) : visibleRead.state === "ready" && lendersRead.state === "failed" ? (
        <p className="mt-4 text-xs leading-5 text-destructive" role="alert">
          {lendersRead.message} Existing applications remain editable; creation is unavailable until the catalog loads.
        </p>
      ) : visibleRead.state === "ready"
        && lendersRead.state === "ready"
        && lendersRead.lenders.length === 0 ? (
        <p className="mt-4 text-xs leading-5 text-muted-foreground" role="status">
          No lenders are available in the catalog, so a new application cannot be created yet.
        </p>
      ) : null}

      {activeCreate ? (
        <form
          className="mt-4 rounded-lg border border-border bg-muted/25 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submitCreate();
          }}
        >
          <fieldset className="space-y-4" disabled={pending !== null}>
            <div>
              <h4 className="text-sm font-semibold">New lender application</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                The selected client is fixed by this tracker record. A lender can appear only once per client.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="new-application-lender">Lender</Label>
                <BrandSelect
                  ariaLabel="Lender for new application"
                  className="mt-2"
                  id="new-application-lender"
                  onValueChange={(bankRef) => setCreateDraft({ ...activeCreate, bankRef })}
                  options={lenderOptions}
                  placeholder="Choose lender"
                  searchPlaceholder="Find a lender"
                  value={activeCreate.bankRef}
                />
              </div>
              <div>
                <Label htmlFor="new-application-amount">Requested amount</Label>
                <Input
                  className="mt-2 tabular-nums"
                  id="new-application-amount"
                  inputMode="decimal"
                  min="0"
                  onChange={(event) => setCreateDraft({ ...activeCreate, amount: event.target.value })}
                  placeholder="Optional"
                  step="0.01"
                  type="number"
                  value={activeCreate.amount}
                />
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setCreateDraft(null)} type="button" variant="ghost">Cancel</Button>
              <Button type="submit">{pending === "create" ? "Creating…" : "Create application"}</Button>
            </div>
          </fieldset>
        </form>
      ) : null}

      {visibleRead.state === "disabled" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Application tracking is not enabled for this workspace.
        </p>
      ) : visibleRead.state === "loading" ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">Loading applications…</p>
      ) : visibleRead.state === "failed" ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive" role="alert">
            {visibleRead.message} No pipeline state is being inferred.
          </p>
          <Button className="mt-3" onClick={() => setReloadVersion((value) => value + 1)} size="sm" variant="outline">
            Try again
          </Button>
        </div>
      ) : applications.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No lender applications have been recorded for this client.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {applications.map((application) => {
            const lender = lenderByRef.get(application.bankRef);
            const editing = activeEdit?.applicationId === application.id;
            const recording = activeOutcome?.applicationId === application.id;
            return (
              <li className="rounded-lg border border-border p-4" key={application.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {lender?.name ?? displayBank(application.bankRef)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {formatAmount(application.amountCents)}
                      {lender?.products.length ? ` · ${lender.products.join(" · ")}` : ""}
                    </p>
                  </div>
                  <StatusPill tone={statusTone(application.consumerStatus)}>
                    {statusLabel(application.consumerStatus)}
                  </StatusPill>
                </div>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Team status</dt>
                    <dd className="mt-0.5 font-medium">{operatorStatusLabel(application.operatorStatus)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Consumer visibility</dt>
                    <dd className="mt-0.5 font-medium">{visibilityLabel(application.visibility)}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={pending !== null} onClick={() => startEdit(application)} size="sm" variant="outline">
                    Edit application
                  </Button>
                  <Button disabled={pending !== null} onClick={() => startOutcome(application)} size="sm" variant="outline">
                    Record outcome
                  </Button>
                </div>

                {editing && activeEdit ? (
                  <form
                    className="mt-4 border-t border-border pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitEdit();
                    }}
                  >
                    <fieldset className="space-y-4" disabled={pending !== null}>
                      <h4 className="text-sm font-semibold">Edit application</h4>
                      <p className="text-xs leading-5 text-muted-foreground">
                        Application status controls the shared tab. Record actual funding separately as an outcome.
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={`operator-status-${application.id}`}>Team status</Label>
                          <BrandSelect
                            ariaLabel={`Team status for ${lender?.name ?? application.bankRef}`}
                            className="mt-2"
                            id={`operator-status-${application.id}`}
                            onValueChange={(value) => setEditDraft({ ...activeEdit, operatorStatus: value as ApplicationOperatorStatus })}
                            options={OPERATOR_STATUS_OPTIONS}
                            value={activeEdit.operatorStatus}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`consumer-status-${application.id}`}>Consumer status</Label>
                          <BrandSelect
                            ariaLabel={`Consumer status for ${lender?.name ?? application.bankRef}`}
                            className="mt-2"
                            id={`consumer-status-${application.id}`}
                            onValueChange={(value) => setEditDraft({ ...activeEdit, consumerStatus: value as ApplicationConsumerStatus })}
                            options={CONSUMER_STATUS_OPTIONS}
                            value={activeEdit.consumerStatus}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`application-amount-${application.id}`}>Application amount</Label>
                          <Input
                            className="mt-2 tabular-nums"
                            id={`application-amount-${application.id}`}
                            inputMode="decimal"
                            min="0"
                            onChange={(event) => setEditDraft({ ...activeEdit, amount: event.target.value })}
                            placeholder="Not recorded"
                            step="0.01"
                            type="number"
                            value={activeEdit.amount}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`application-visibility-${application.id}`}>Consumer visibility</Label>
                          <BrandSelect
                            ariaLabel={`Consumer visibility for ${lender?.name ?? application.bankRef}`}
                            className="mt-2"
                            id={`application-visibility-${application.id}`}
                            onValueChange={(value) => setEditDraft({ ...activeEdit, visibility: value as ApplicationVisibility })}
                            options={VISIBILITY_OPTIONS}
                            value={activeEdit.visibility}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button onClick={() => setEditDraft(null)} type="button" variant="ghost">Cancel</Button>
                        <Button type="submit">
                          {pending === `edit:${application.id}` ? "Saving…" : "Save changes"}
                        </Button>
                      </div>
                    </fieldset>
                  </form>
                ) : null}

                {recording && activeOutcome ? (
                  <form
                    className="mt-4 border-t border-border pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitOutcome();
                    }}
                  >
                    <fieldset className="space-y-4" disabled={pending !== null}>
                      <div>
                        <h4 className="text-sm font-semibold">Record funding outcome</h4>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Outcomes are durable and counted in lender reporting. They do not rewrite the shared application status; a platform admin handles corrections.
                        </p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={`outcome-kind-${application.id}`}>Outcome</Label>
                          <BrandSelect
                            ariaLabel={`Funding outcome for ${lender?.name ?? application.bankRef}`}
                            className="mt-2"
                            id={`outcome-kind-${application.id}`}
                            onValueChange={(value) => setOutcomeDraft({ ...activeOutcome, kind: value as OutcomeKind })}
                            options={OUTCOME_OPTIONS}
                            value={activeOutcome.kind}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`outcome-date-${application.id}`}>Decision date</Label>
                          <Input
                            className="mt-2 tabular-nums"
                            id={`outcome-date-${application.id}`}
                            onChange={(event) => setOutcomeDraft({ ...activeOutcome, decidedOn: event.target.value })}
                            type="date"
                            value={activeOutcome.decidedOn}
                          />
                        </div>
                        {activeOutcome.kind === "approved" ? (
                          <div className="sm:col-span-2">
                            <Label htmlFor={`outcome-amount-${application.id}`}>Approved amount</Label>
                            <Input
                              className="mt-2 tabular-nums sm:max-w-xs"
                              id={`outcome-amount-${application.id}`}
                              inputMode="decimal"
                              min="0.01"
                              onChange={(event) => setOutcomeDraft({ ...activeOutcome, amount: event.target.value })}
                              placeholder="Required"
                              step="0.01"
                              type="number"
                              value={activeOutcome.amount}
                            />
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button onClick={() => setOutcomeDraft(null)} type="button" variant="ghost">Cancel</Button>
                        <Button type="submit">
                          {pending === `outcome:${application.id}` ? "Recording…" : "Record outcome"}
                        </Button>
                      </div>
                    </fieldset>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
