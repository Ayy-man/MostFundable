"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BrandSelect } from "@/components/ui/brand-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type {
  FeeAgreement,
  FeeAgreementInput,
  FeeAgreementStatus,
  FeePayment,
  FeePaymentMethod,
} from "@/lib/fees/types";
import {
  paymentDate,
  readClientFeeDetails,
  recordFeePayment,
  reverseFeePayment,
  setClientFeeAgreement,
  type ClientFeesRead,
} from "@/lib/operator/fees.client";

const ADMIN_PAYMENT_NOTE = "[fee-component:admin-upfront]";
const SUCCESS_PAYMENT_NOTE = "[fee-component:success]";

const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{
  label: string;
  value: FeePaymentMethod;
}> = [
  { label: "Bank transfer", value: "bank_transfer" },
  { label: "Card", value: "card" },
  { label: "Check", value: "check" },
  { label: "Cash", value: "cash" },
  { label: "Other", value: "other" },
];

const PAYMENT_METHOD_LABELS = new Map(
  PAYMENT_METHOD_OPTIONS.map((option) => [option.value, option.label]),
);

type SuccessModel = "percentage" | "custom" | "package";

function parseDollars(value: string): number | null {
  if (value.trim() === "") return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const amountCents = Math.round((amount + Number.EPSILON) * 100);
  return Number.isSafeInteger(amountCents) ? amountCents : null;
}

function dollars(cents: number | null | undefined) {
  return cents == null ? "" : String(cents / 100);
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(cents / 100);
}

function displayDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(parsed);
}

function activeComponentPayments(
  payments: readonly FeePayment[],
  note: string,
) {
  return payments.filter(
    (payment) => payment.reversedAt === null && payment.note === note,
  );
}

function storedAgreementInput(
  agreement: FeeAgreement,
  status: FeeAgreementStatus,
): FeeAgreementInput {
  return {
    customTotalCents: agreement.customTotalCents,
    model: agreement.model,
    pct: agreement.pct,
    status,
    successCents: agreement.successCents,
    triggerCents: agreement.triggerCents,
    upfrontCents: agreement.upfrontCents,
  };
}

function paymentNote(payment: FeePayment) {
  if (payment.note === ADMIN_PAYMENT_NOTE) return "Admin upfront marked paid";
  if (payment.note === SUCCESS_PAYMENT_NOTE) return "Success fee marked paid";
  return payment.note;
}

export function FeeEditSheet({
  clientId,
  clientName,
  fixture,
  onOpenChange,
  onFixtureSave,
  onSaved,
  open,
  upfrontApproved,
}: {
  clientId: string | null;
  clientName: string;
  fixture?: {
    fundedAmount: number;
    model: "percent" | "custom" | "package" | "unconfigured";
    paid: number;
    totalFee: number;
    triggerAmount?: number;
    upfrontAmount?: number;
  };
  onOpenChange: (open: boolean) => void;
  onFixtureSave?: (value: {
    model: "percent" | "custom";
    paid: number;
    totalFee: number;
    triggerAmount: number;
    upfrontAmount: number;
  }) => void;
  onSaved: () => void;
  open: boolean;
  upfrontApproved: boolean;
}) {
  const [readSnapshot, setReadSnapshot] = useState<{
    clientId: string | null;
    read: ClientFeesRead;
  }>({ clientId: null, read: { state: "loading" } });
  const activeClientIdRef = useRef(clientId);
  const read = useMemo<ClientFeesRead>(
    () => readSnapshot.clientId === clientId
      ? readSnapshot.read
      : { state: "loading" },
    [clientId, readSnapshot],
  );
  const [model, setModel] = useState<SuccessModel>("percentage");
  const [upfrontAmount, setUpfrontAmount] = useState("");
  const [successAmount, setSuccessAmount] = useState("");
  const [triggerAmount, setTriggerAmount] = useState("");
  const [adminPaid, setAdminPaid] = useState(false);
  const [successPaid, setSuccessPaid] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReceivedOn, setPaymentReceivedOn] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<FeePaymentMethod>("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMemo, setPaymentMemo] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [voidConfirming, setVoidConfirming] = useState(false);
  const [reverseCandidateId, setReverseCandidateId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const applyRead = useCallback((forClientId: string, next: ClientFeesRead) => {
    if (activeClientIdRef.current !== forClientId) return false;
    setReadSnapshot({ clientId: forClientId, read: next });
    if (next.state !== "ready") return true;
    const { agreement, payments } = next.fees;
    const nextModel: SuccessModel = agreement?.model ?? "percentage";
    setModel(nextModel);
    setUpfrontAmount(dollars(agreement?.upfrontCents));
    setSuccessAmount(
      nextModel === "percentage"
        ? agreement?.pct == null
          ? ""
          : String(agreement.pct)
        : dollars(agreement?.model === "package" ? agreement.successCents : agreement?.customTotalCents),
    );
    setTriggerAmount(dollars(agreement?.triggerCents));
    setAdminPaid(activeComponentPayments(payments, ADMIN_PAYMENT_NOTE).length > 0);
    setSuccessPaid(activeComponentPayments(payments, SUCCESS_PAYMENT_NOTE).length > 0);
    return true;
  }, []);

  useEffect(() => {
    if (!open || clientId === null) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setProblem(null);
      setNotice(null);
      setVoidConfirming(false);
      setReverseCandidateId(null);
      setPendingAction(null);
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentMemo("");
      setPaymentReceivedOn(paymentDate(new Date()));

      if (fixture) {
        const nextModel: SuccessModel = fixture.model === "percent"
          ? "percentage"
          : "custom";
        const success = nextModel === "percentage"
          ? fixture.fundedAmount > 0
            ? (fixture.totalFee / fixture.fundedAmount) * 100
            : 10
          : fixture.totalFee;
        setModel(nextModel);
        setUpfrontAmount(String(fixture.upfrontAmount ?? 0));
        setSuccessAmount(String(success));
        setTriggerAmount(fixture.triggerAmount ? String(fixture.triggerAmount) : "");
        setAdminPaid(
          (fixture.upfrontAmount ?? 0) > 0
          && fixture.paid >= (fixture.upfrontAmount ?? 0),
        );
        setSuccessPaid(fixture.totalFee > 0 && fixture.paid >= fixture.totalFee);
        setReadSnapshot({
          clientId,
          read: {
            fees: {
              agreement: null,
              clientId,
              ledger: {
                balanceCents: Math.round((fixture.totalFee - fixture.paid) * 100),
                clientId,
                orgId: "fixture",
                outcomeBasisCents: Math.round(fixture.fundedAmount * 100),
                outcomeBasisSource: "fixture",
                paidCents: Math.round(fixture.paid * 100),
                totalCents: Math.round(fixture.totalFee * 100),
                updatedAt: "2026-08-30T00:00:00.000Z",
              },
              payments: [],
            },
            state: "ready",
          },
        });
        return;
      }

      setReadSnapshot({ clientId, read: { state: "loading" } });
      void readClientFeeDetails(clientId).then((next) => {
        if (active) applyRead(clientId, next);
      });
    });
    return () => {
      active = false;
    };
  }, [applyRead, clientId, fixture, open]);

  const amounts = useMemo(() => {
    const parsedUpfront = parseDollars(upfrontAmount);
    const parsedSuccess = parseDollars(successAmount);
    const parsedTrigger = triggerAmount.trim() === "" ? null : parseDollars(triggerAmount);
    const percentage = successAmount.trim() === "" ? 0 : Number(successAmount);
    const percentageValid = Number.isFinite(percentage)
      && percentage >= 0
      && percentage <= 100
      && Math.round(percentage * 100) === percentage * 100;
    const basis = read.state === "ready"
      ? (read.fees.ledger?.outcomeBasisCents ?? 0)
      : 0;
    const triggerValid = triggerAmount.trim() === "" || parsedTrigger !== null;
    const valid = parsedUpfront !== null
      && parsedSuccess !== null
      && triggerValid
      && (model !== "percentage" || percentageValid);
    const upfrontCents = parsedUpfront ?? 0;
    const successCents = model === "percentage"
      ? Math.round(basis * (percentageValid ? percentage : 0) / 100)
      : model === "custom" && parsedTrigger !== null && basis < parsedTrigger
        ? 0
        : (parsedSuccess ?? 0);
    return {
      basis,
      percentage,
      successCents,
      successInputCents: parsedSuccess ?? 0,
      triggerCents: parsedTrigger,
      upfrontCents,
      valid,
    };
  }, [model, read, successAmount, triggerAmount, upfrontAmount]);

  async function readBack(forClientId: string, message: string) {
    const next = await readClientFeeDetails(forClientId);
    const applied = applyRead(forClientId, next);
    onSaved();
    if (!applied) return false;
    if (next.state !== "ready") {
      setProblem("The change may have been saved, but the latest fee record could not be verified.");
      setNotice(null);
      return false;
    }
    setProblem(null);
    setNotice(message);
    return true;
  }

  function agreementInput(status: FeeAgreementStatus): FeeAgreementInput {
    return {
      customTotalCents: model === "custom" ? amounts.successInputCents : null,
      model,
      pct: model === "percentage" ? amounts.percentage : null,
      status,
      successCents: model === "package" ? amounts.successInputCents : null,
      triggerCents: model === "custom"
        ? amounts.triggerCents
        : model === "package" && agreement?.model === "package"
          ? agreement.triggerCents
          : null,
      upfrontCents: amounts.upfrontCents > 0 ? amounts.upfrontCents : null,
    };
  }

  async function saveFixture() {
    if (!fixture || !onFixtureSave || !amounts.valid) return;
    const totalFee = (amounts.upfrontCents + amounts.successCents) / 100;
    onFixtureSave({
      model: model === "percentage" ? "percent" : "custom",
      paid: (
        (adminPaid ? amounts.upfrontCents : 0)
        + (successPaid ? amounts.successCents : 0)
      ) / 100,
      totalFee,
      triggerAmount: (amounts.triggerCents ?? 0) / 100,
      upfrontAmount: amounts.upfrontCents / 100,
    });
    onSaved();
    onOpenChange(false);
  }

  async function saveAgreement() {
    if (clientId === null || read.state !== "ready" || fixture) return;
    const mutationClientId = clientId;
    if (!amounts.valid) {
      setProblem("Enter valid fee amounts and a percentage from 0 to 100.");
      return;
    }
    setPendingAction("agreement");
    setProblem(null);
    setNotice(null);
    const creating = read.fees.agreement === null;
    const result = await setClientFeeAgreement(mutationClientId, agreementInput("active"));
    if (!result.ok) {
      if (activeClientIdRef.current === mutationClientId) {
        setProblem("The fee agreement could not be saved.");
        setPendingAction(null);
      }
      return;
    }
    await readBack(mutationClientId, creating ? "Fee agreement created." : "Fee agreement amended.");
    if (activeClientIdRef.current === mutationClientId) setPendingAction(null);
  }

  async function changeAgreementStatus(status: "active" | "void") {
    if (clientId === null || read.state !== "ready" || read.fees.agreement === null) return;
    const mutationClientId = clientId;
    const mutationAgreement = read.fees.agreement;
    setPendingAction(status);
    setProblem(null);
    setNotice(null);
    const result = await setClientFeeAgreement(
      mutationClientId,
      storedAgreementInput(mutationAgreement, status),
    );
    if (!result.ok) {
      if (activeClientIdRef.current === mutationClientId) {
        setProblem(
          status === "void"
            ? "The fee agreement could not be voided."
            : "The fee agreement could not be reactivated. Check the workspace legal approval for these terms.",
        );
        setPendingAction(null);
      }
      return;
    }
    await readBack(
      mutationClientId,
      status === "void" ? "Fee agreement voided." : "Fee agreement reactivated.",
    );
    if (activeClientIdRef.current === mutationClientId) {
      setVoidConfirming(false);
      setPendingAction(null);
    }
  }

  async function addPayment() {
    if (clientId === null || read.state !== "ready" || fixture) return;
    const mutationClientId = clientId;
    const amountCents = parseDollars(paymentAmount);
    const today = paymentDate(new Date());
    if (amountCents === null || amountCents <= 0) {
      setProblem("Enter a payment amount greater than zero.");
      return;
    }
    if (paymentReceivedOn === "" || paymentReceivedOn > today) {
      setProblem("Choose a received date that is not in the future.");
      return;
    }
    if (paymentReference.length > 120 || paymentMemo.length > 1000) {
      setProblem("The reference can be at most 120 characters and the note at most 1,000.");
      return;
    }

    setPendingAction("payment");
    setProblem(null);
    setNotice(null);
    const result = await recordFeePayment(mutationClientId, {
      amountCents,
      method: paymentMethod,
      note: paymentMemo.trim() || null,
      receivedOn: paymentReceivedOn,
      reference: paymentReference.trim() || null,
    });
    if (!result.ok) {
      if (activeClientIdRef.current === mutationClientId) {
        setProblem("The payment could not be recorded. Check that the reference is not already in use.");
        setPendingAction(null);
      }
      return;
    }
    if (activeClientIdRef.current === mutationClientId) {
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentMemo("");
    }
    await readBack(mutationClientId, "Payment recorded.");
    if (activeClientIdRef.current === mutationClientId) setPendingAction(null);
  }

  async function reversePayment(paymentId: string) {
    if (fixture || clientId === null) return;
    const mutationClientId = clientId;
    setPendingAction(`reverse:${paymentId}`);
    setProblem(null);
    setNotice(null);
    const result = await reverseFeePayment(paymentId);
    if (!result.ok) {
      if (activeClientIdRef.current === mutationClientId) {
        setProblem("The payment could not be reversed. It may already have been reversed.");
        setPendingAction(null);
      }
      return;
    }
    if (activeClientIdRef.current === mutationClientId) setReverseCandidateId(null);
    await readBack(mutationClientId, "Payment reversed.");
    if (activeClientIdRef.current === mutationClientId) setPendingAction(null);
  }

  const successUnit = model === "percentage" ? "%" : "$";
  const thresholdMet = amounts.triggerCents === null || amounts.basis >= amounts.triggerCents;
  const agreement = read.state === "ready" ? read.fees.agreement : null;
  const ledger = read.state === "ready" ? read.fees.ledger : null;
  const payments = read.state === "ready" ? read.fees.payments : [];
  const agreementVoided = agreement?.status === "void";
  const paymentDisabled = pendingAction !== null || agreement?.status !== "active";

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b border-border pr-14">
          <SheetTitle>Client fee agreement</SheetTitle>
          <SheetDescription>{clientName}</SheetDescription>
        </SheetHeader>

        <div className="space-y-7 px-4 pb-6">
          {read.state === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading fee agreement…</p>
          ) : read.state === "disabled" ? (
            <p className="text-sm text-muted-foreground">Fee tracking is not enabled.</p>
          ) : read.state === "failed" ? (
            <p className="text-sm text-destructive" role="alert">
              The fee agreement could not be loaded.
            </p>
          ) : (
            <>
              {!fixture ? (
                <section aria-labelledby="agreement-state-title">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold" id="agreement-state-title">Agreement</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {agreement === null
                          ? "No fee agreement has been recorded."
                          : agreement.status === "void"
                            ? "Voided · no fee is currently due."
                            : agreement.status === "draft"
                              ? "Draft · save the terms below to activate it."
                              : "Active · payments are tracked against the current terms."}
                      </p>
                    </div>
                    <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium capitalize">
                      {agreement?.status ?? "Not created"}
                    </span>
                  </div>
                </section>
              ) : null}

              <section aria-labelledby="admin-fee-title">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold" id="admin-fee-title">Admin upfront</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {upfrontApproved
                        ? "Legal sign-off is recorded for this workspace."
                        : "Unavailable until legal sign-off is recorded."}
                    </p>
                  </div>
                  {fixture ? (
                    <Switch
                      aria-label="Admin upfront paid"
                      checked={adminPaid}
                      disabled={!upfrontApproved || amounts.upfrontCents === 0}
                      onCheckedChange={setAdminPaid}
                    />
                  ) : null}
                </div>
                <label className="mt-4 block text-xs font-medium text-muted-foreground">
                  Amount
                  <Input
                    className="mt-1 tabular-nums"
                    disabled={!upfrontApproved || agreementVoided || pendingAction !== null}
                    min="0"
                    onChange={(event) => setUpfrontAmount(event.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    type="number"
                    value={upfrontAmount}
                  />
                </label>
                {fixture ? (
                  <p className="mt-2 text-xs text-muted-foreground">Paid: {adminPaid ? "Yes" : "No"}</p>
                ) : null}
              </section>

              <section className="border-t border-border pt-6" aria-labelledby="success-fee-title">
                <h3 className="text-sm font-semibold" id="success-fee-title">Success fee</h3>
                <div className="mt-4 grid gap-4">
                  <label className="text-xs font-medium text-muted-foreground">
                    Model
                    <BrandSelect
                      ariaLabel="Success fee model"
                      className="mt-1 w-full"
                      disabled={agreementVoided || pendingAction !== null}
                      onValueChange={(value) => setModel(value as SuccessModel)}
                      options={[
                        { label: "% of funded", value: "percentage" },
                        { label: "Flat amount", value: "custom" },
                        ...(!fixture
                          ? [{
                              description: upfrontApproved
                                ? "Upfront plus fixed success terms"
                                : "Requires recorded legal sign-off",
                              disabled: !upfrontApproved,
                              label: "Package",
                              value: "package",
                            }]
                          : []),
                      ]}
                      value={model}
                    />
                  </label>
                  <label className="text-xs font-medium text-muted-foreground">
                    {model === "percentage"
                      ? "Percentage"
                      : model === "package"
                        ? "Success amount"
                        : "Flat amount"}
                    <div className="relative mt-1">
                      <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">{successUnit}</span>
                      <Input
                        className="pl-8 tabular-nums"
                        disabled={agreementVoided || pendingAction !== null}
                        max={model === "percentage" ? "100" : undefined}
                        min="0"
                        onChange={(event) => setSuccessAmount(event.target.value)}
                        step="0.01"
                        type="number"
                        value={successAmount}
                      />
                    </div>
                  </label>
                  {model === "custom" ? (
                    <label className="text-xs font-medium text-muted-foreground">
                      Funding trigger
                      <div className="relative mt-1">
                        <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">$</span>
                        <Input
                          className="pl-8 tabular-nums"
                          disabled={agreementVoided || pendingAction !== null}
                          min="0"
                          onChange={(event) => setTriggerAmount(event.target.value)}
                          placeholder="No trigger"
                          step="0.01"
                          type="number"
                          value={triggerAmount}
                        />
                      </div>
                      <span className="mt-1 block font-normal">
                        {thresholdMet
                          ? "The recorded funded total meets this trigger."
                          : `Nothing is owed until recorded funding reaches ${money(amounts.triggerCents!)}.`}
                      </span>
                    </label>
                  ) : null}
                  {fixture ? (
                    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
                      <div>
                        <p className="text-sm font-medium">Paid</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {amounts.successCents > 0
                            ? "Records bookkeeping payment status."
                            : "No success fee is due yet."}
                        </p>
                      </div>
                      <Switch
                        aria-label="Success fee paid"
                        checked={successPaid}
                        disabled={amounts.successCents === 0}
                        onCheckedChange={setSuccessPaid}
                      />
                    </div>
                  ) : null}
                </div>
              </section>

              {!fixture ? (
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
                  {agreement !== null && !agreementVoided && !voidConfirming ? (
                    <Button
                      disabled={pendingAction !== null}
                      onClick={() => setVoidConfirming(true)}
                      variant="destructive"
                    >
                      Void agreement
                    </Button>
                  ) : null}
                  {agreement !== null && !agreementVoided && voidConfirming ? (
                    <>
                      <span className="mr-auto self-center text-xs text-destructive">
                        Void this agreement and set the amount due to zero?
                      </span>
                      <Button
                        disabled={pendingAction !== null}
                        onClick={() => setVoidConfirming(false)}
                        variant="ghost"
                      >
                        Keep agreement
                      </Button>
                      <Button
                        disabled={pendingAction !== null}
                        onClick={() => { void changeAgreementStatus("void"); }}
                        variant="destructive"
                      >
                        {pendingAction === "void" ? "Voiding…" : "Confirm void"}
                      </Button>
                    </>
                  ) : null}
                  {agreementVoided ? (
                    <Button
                      disabled={pendingAction !== null}
                      onClick={() => { void changeAgreementStatus("active"); }}
                    >
                      {pendingAction === "active" ? "Reactivating…" : "Reactivate agreement"}
                    </Button>
                  ) : (
                    <Button
                      disabled={pendingAction !== null || !amounts.valid}
                      onClick={() => { void saveAgreement(); }}
                    >
                      {pendingAction === "agreement"
                        ? "Saving…"
                        : agreement === null
                          ? "Create agreement"
                          : agreement.status === "draft"
                            ? "Activate agreement"
                            : "Save changes"}
                    </Button>
                  )}
                </div>
              ) : null}

              {!fixture ? (
                <section className="border-t border-border pt-6" aria-labelledby="fee-balance-title">
                  <h3 className="text-sm font-semibold" id="fee-balance-title">Payment balance</h3>
                  <div className="mt-3 grid divide-y divide-border rounded-lg border border-border bg-muted/25 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                    {[
                      { label: "Due", value: ledger?.totalCents ?? 0 },
                      { label: "Paid", value: ledger?.paidCents ?? 0 },
                      { label: "Balance", value: ledger?.balanceCents ?? 0 },
                    ].map((item) => (
                      <div className="min-w-0 px-3 py-3" key={item.label}>
                        <p className="text-[11px] font-medium text-muted-foreground">{item.label}</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums">{money(item.value)}</p>
                      </div>
                    ))}
                  </div>
                  {ledger !== null && ledger.balanceCents < 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      The negative balance records an overpayment credit; no money is moved by this screen.
                    </p>
                  ) : null}
                </section>
              ) : null}

              {!fixture ? (
                <section className="border-t border-border pt-6" aria-labelledby="record-payment-title">
                  <h3 className="text-sm font-semibold" id="record-payment-title">Record a payment</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Bookkeeping only. This records money received elsewhere and does not charge the client.
                  </p>
                  {agreement?.status !== "active" ? (
                    <p className="mt-3 rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                      {agreement === null
                        ? "Create an agreement before recording a payment."
                        : agreementVoided
                          ? "Reactivate the agreement before recording another payment."
                          : "Activate the draft agreement before recording a payment."}
                    </p>
                  ) : null}
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Amount received
                      <div className="relative mt-1">
                        <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">$</span>
                        <Input
                          className="pl-8 tabular-nums"
                          disabled={paymentDisabled}
                          min="0.01"
                          onChange={(event) => setPaymentAmount(event.target.value)}
                          placeholder="0.00"
                          step="0.01"
                          type="number"
                          value={paymentAmount}
                        />
                      </div>
                    </label>
                    <label className="text-xs font-medium text-muted-foreground">
                      Date received
                      <Input
                        className="mt-1 tabular-nums"
                        disabled={paymentDisabled}
                        max={paymentDate(new Date())}
                        onChange={(event) => setPaymentReceivedOn(event.target.value)}
                        type="date"
                        value={paymentReceivedOn}
                      />
                    </label>
                    <label className="text-xs font-medium text-muted-foreground">
                      Method
                      <BrandSelect
                        ariaLabel="Payment method"
                        className="mt-1 w-full"
                        disabled={paymentDisabled}
                        onValueChange={(value) => setPaymentMethod(value as FeePaymentMethod)}
                        options={PAYMENT_METHOD_OPTIONS}
                        value={paymentMethod}
                      />
                    </label>
                    <label className="text-xs font-medium text-muted-foreground">
                      Reference <span className="font-normal">(optional)</span>
                      <Input
                        className="mt-1"
                        disabled={paymentDisabled}
                        maxLength={120}
                        onChange={(event) => setPaymentReference(event.target.value)}
                        placeholder="Bank or check reference"
                        value={paymentReference}
                      />
                    </label>
                  </div>
                  <label className="mt-4 block text-xs font-medium text-muted-foreground">
                    Note <span className="font-normal">(optional)</span>
                    <textarea
                      className="mt-1 min-h-20 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={paymentDisabled}
                      maxLength={1000}
                      onChange={(event) => setPaymentMemo(event.target.value)}
                      placeholder="Reconciliation note"
                      value={paymentMemo}
                    />
                  </label>
                  <div className="mt-4 flex justify-end">
                    <Button
                      disabled={paymentDisabled || paymentAmount.trim() === ""}
                      onClick={() => { void addPayment(); }}
                    >
                      {pendingAction === "payment" ? "Recording…" : "Record payment"}
                    </Button>
                  </div>
                </section>
              ) : null}

              {!fixture ? (
                <section className="border-t border-border pt-6" aria-labelledby="payment-history-title">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold" id="payment-history-title">Payment history</h3>
                    <span className="text-xs text-muted-foreground">
                      {payments.length} {payments.length === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                  {payments.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No payments have been recorded.</p>
                  ) : (
                    <div className="mt-3 divide-y divide-border border-y border-border">
                      {payments.map((payment) => {
                        const reversed = payment.reversedAt !== null;
                        const confirming = reverseCandidateId === payment.id;
                        return (
                          <div className="py-4" key={payment.id}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-semibold tabular-nums">{money(payment.amountCents)}</span>
                                  {reversed ? (
                                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium">Reversed</span>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {displayDate(payment.receivedOn)} · {PAYMENT_METHOD_LABELS.get(payment.method) ?? payment.method}
                                </p>
                                {payment.reference ? (
                                  <p className="mt-1 break-words text-xs text-muted-foreground">Reference: {payment.reference}</p>
                                ) : null}
                                {paymentNote(payment) ? (
                                  <p className="mt-1 break-words text-xs text-muted-foreground">{paymentNote(payment)}</p>
                                ) : null}
                              </div>
                              {!reversed && !confirming ? (
                                <Button
                                  disabled={pendingAction !== null}
                                  onClick={() => setReverseCandidateId(payment.id)}
                                  variant="outline"
                                >
                                  Reverse
                                </Button>
                              ) : null}
                            </div>
                            {confirming && !reversed ? (
                              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                                <span className="mr-auto text-xs text-destructive">Reverse this ledger entry?</span>
                                <Button
                                  disabled={pendingAction !== null}
                                  onClick={() => setReverseCandidateId(null)}
                                  variant="ghost"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  disabled={pendingAction !== null}
                                  onClick={() => { void reversePayment(payment.id); }}
                                  variant="destructive"
                                >
                                  {pendingAction === `reverse:${payment.id}` ? "Reversing…" : "Confirm reversal"}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : null}

              {problem ? <p className="text-sm text-destructive" role="alert">{problem}</p> : null}
              {notice ? <p className="text-sm text-primary-ink" role="status">{notice}</p> : null}

              <div className="flex justify-end gap-2 border-t border-border pt-5">
                <Button
                  disabled={pendingAction !== null}
                  onClick={() => onOpenChange(false)}
                  variant="outline"
                >
                  Close
                </Button>
                {fixture ? (
                  <Button
                    disabled={pendingAction !== null || !amounts.valid}
                    onClick={() => { void saveFixture(); }}
                  >
                    Save fees
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
