"use client";

import { Archive, Plus, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyState, Panel, StatusPill } from "@/components/demo/shared";
import { BrandSelect } from "@/components/ui/brand-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminBankCatalogError,
  changeAdminBankCatalogStatus,
  createAdminBankCatalogEntry,
  loadAdminBankCatalog,
  updateAdminBankCatalogEntry,
  type AdminBankCatalogContent,
  type AdminBankCatalogEntry,
} from "@/lib/admin/bank-catalog-client";
import { STANDING_APPLICATION_QUESTIONS } from "@/lib/vault/standing-questions";

type CatalogState = "disabled" | "failed" | "loading" | "ready";
type CatalogNotice = { text: string; tone: "success" | "warning" } | null;
type EditorQuestion = { id: string; label: string; responseBasis: string };
type CatalogEditor = {
  bankRef: string;
  bureauPulls: string;
  channelType: "In person" | "Not recorded" | "Online" | "Phone";
  channelValue: string;
  checkingDepositDollars: string;
  checkingRequired: "No" | "Not recorded" | "Yes";
  checkingSeasoning: string;
  extraQuestions: EditorQuestion[];
  name: string;
  originalRef: string | null;
  products: string;
  qualificationSummary: string;
  relationshipManagerRequired: "No" | "Not recorded" | "Yes";
  relationshipManagerTip: string;
  sourceUpdatedAt: string;
};

const CHANNEL_OPTIONS = ["Not recorded", "Online", "Phone", "In person"];
const BOOLEAN_OPTIONS = ["Not recorded", "Yes", "No"];

function booleanLabel(value: boolean | null): CatalogEditor["checkingRequired"] {
  return value === null ? "Not recorded" : value ? "Yes" : "No";
}

function booleanValue(value: CatalogEditor["checkingRequired"]): boolean | null {
  return value === "Not recorded" ? null : value === "Yes";
}

function sourceLabel(source: AdminBankCatalogEntry["source"]): string {
  if (source === "vault") return "VAULT sync";
  if (source === "manual") return "Manual";
  if (source === "backfill") return "Backfill";
  return "Fixture";
}

function emptyEditor(): CatalogEditor {
  return {
    bankRef: "",
    bureauPulls: "",
    channelType: "Not recorded",
    channelValue: "",
    checkingDepositDollars: "",
    checkingRequired: "Not recorded",
    checkingSeasoning: "",
    extraQuestions: [],
    name: "",
    originalRef: null,
    products: "",
    qualificationSummary: "",
    relationshipManagerRequired: "Not recorded",
    relationshipManagerTip: "",
    sourceUpdatedAt: "",
  };
}

function editorFor(bank: AdminBankCatalogEntry): CatalogEditor {
  return {
    bankRef: bank.bankRef,
    bureauPulls: bank.bureauPulls ?? "",
    channelType: bank.channel?.type === "online"
      ? "Online"
      : bank.channel?.type === "phone"
        ? "Phone"
        : bank.channel?.type === "in-person"
          ? "In person"
          : "Not recorded",
    channelValue: bank.channel?.value ?? "",
    checkingDepositDollars: bank.checking.depositAmountCents === null
      ? ""
      : (bank.checking.depositAmountCents / 100).toFixed(2),
    checkingRequired: booleanLabel(bank.checking.required),
    checkingSeasoning: bank.checking.seasoning ?? "",
    extraQuestions: bank.applicationQuestions
      .slice(STANDING_APPLICATION_QUESTIONS.length)
      .map((question) => ({ ...question })),
    name: bank.name,
    originalRef: bank.bankRef,
    products: bank.products.join(", "),
    qualificationSummary: bank.qualificationSummary ?? "",
    relationshipManagerRequired: booleanLabel(bank.relationshipManager.required),
    relationshipManagerTip: bank.relationshipManager.tip ?? "",
    sourceUpdatedAt: bank.sourceUpdatedAt ?? "",
  };
}

function cents(value: string): number | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const amount = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(amount) && amount <= 2_147_483_647 ? amount : undefined;
}

function contentFor(editor: CatalogEditor): AdminBankCatalogContent | null {
  const depositAmountCents = cents(editor.checkingDepositDollars);
  if (depositAmountCents === undefined) return null;
  const channel = editor.channelType === "Not recorded"
    ? null
    : editor.channelType === "In person"
      ? { type: "in-person" as const, value: null }
      : {
          type: editor.channelType === "Online" ? "online" as const : "phone" as const,
          value: editor.channelValue.trim(),
        };
  return {
    applicationQuestions: [
      ...STANDING_APPLICATION_QUESTIONS,
      ...editor.extraQuestions.map((question) => ({
        id: question.id.trim(),
        label: question.label.trim(),
        responseBasis: question.responseBasis.trim(),
      })),
    ],
    bureauPulls: editor.bureauPulls.trim() || null,
    channel,
    checking: {
      depositAmountCents,
      required: booleanValue(editor.checkingRequired),
      seasoning: editor.checkingSeasoning.trim() || null,
    },
    name: editor.name.trim(),
    products: editor.products.split(",").map((product) => product.trim()).filter(Boolean),
    qualificationSummary: editor.qualificationSummary.trim() || null,
    relationshipManager: {
      required: booleanValue(editor.relationshipManagerRequired),
      tip: editor.relationshipManagerTip.trim() || null,
    },
    sourceUpdatedAt: editor.sourceUpdatedAt || null,
  };
}

function catalogError(error: unknown, action: string): string {
  if (!(error instanceof AdminBankCatalogError)) {
    return `The lender ${action} did not complete. No catalog change was confirmed.`;
  }
  if (error.code === "bank_catalog_already_exists") {
    return "That bank reference already exists. Edit its existing row instead.";
  }
  if (error.code === "bank_catalog_not_found") {
    return "That lender no longer exists in the catalog. Reload the list before trying again.";
  }
  if (error.code === "bank_catalog_input_invalid") {
    return "Check the lender fields. URLs must use HTTPS, phone channels need a number, products must be unique, and question IDs use lowercase letters, numbers, hyphens, or underscores.";
  }
  return `The lender ${action} did not complete. No catalog change was confirmed.`;
}

function replaceBank(
  rows: readonly AdminBankCatalogEntry[],
  bank: AdminBankCatalogEntry,
): readonly AdminBankCatalogEntry[] {
  return Object.freeze([
    ...rows.filter((row) => row.bankRef !== bank.bankRef),
    bank,
  ].sort((left, right) => left.name.localeCompare(right.name) || left.bankRef.localeCompare(right.bankRef)));
}

export function AdminBankCatalogManagement({
  enabled,
  onMutation,
}: {
  enabled: boolean;
  onMutation?: (event: { action: string; risk: "High" | "Review"; target: string }) => void;
}) {
  const [banks, setBanks] = useState<readonly AdminBankCatalogEntry[]>([]);
  const [state, setState] = useState<CatalogState>(enabled ? "loading" : "disabled");
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState("All visibility");
  const [editor, setEditor] = useState<CatalogEditor | null>(null);
  const [archiveCandidate, setArchiveCandidate] = useState<AdminBankCatalogEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<CatalogNotice>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void Promise.resolve()
      .then(() => { if (active) setState("loading"); })
      .then(() => loadAdminBankCatalog())
      .then((result) => {
        if (!active) return;
        if (result === null) {
          setState("disabled");
          setBanks([]);
        } else {
          setBanks(result);
          setState("ready");
        }
      })
      .catch(() => {
        if (active) setState("failed");
      });
    return () => { active = false; };
  }, [enabled]);

  const displayedState: CatalogState = enabled ? state : "disabled";

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return banks.filter((bank) => {
      const matchesQuery = !term
        || bank.name.toLowerCase().includes(term)
        || bank.bankRef.toLowerCase().includes(term)
        || bank.products.some((product) => product.toLowerCase().includes(term));
      const matchesVisibility = visibility === "All visibility"
        || (visibility === "Active" ? bank.isActive : !bank.isActive);
      return matchesQuery && matchesVisibility;
    });
  }, [banks, query, visibility]);

  const activeCount = banks.filter((bank) => bank.isActive).length;
  const archivedCount = banks.length - activeCount;

  async function saveEditor() {
    if (!editor) return;
    const content = contentFor(editor);
    if (!content) {
      setNotice({ tone: "warning", text: "Enter the checking deposit as dollars with at most two decimal places." });
      return;
    }
    const action = editor.originalRef === null ? "creation" : "update";
    setBusy(editor.originalRef ?? "create");
    setNotice(null);
    try {
      const saved = editor.originalRef === null
        ? await createAdminBankCatalogEntry({ bankRef: editor.bankRef.trim(), ...content })
        : await updateAdminBankCatalogEntry(editor.originalRef, content);
      setBanks((current) => replaceBank(current, saved));
      setEditor(null);
      setNotice({
        tone: "success",
        text: `${saved.name} was ${action === "creation" ? "created" : "updated"}. The row above is the database readback; nightly sync data remains underneath any admin override.`,
      });
      onMutation?.({
        action: `${action === "creation" ? "Created" : "Updated"} lender ${saved.name}`,
        risk: "Review",
        target: `bank_catalog.${saved.bankRef}`,
      });
    } catch (error) {
      setNotice({ tone: "warning", text: catalogError(error, action) });
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(bank: AdminBankCatalogEntry, action: "archive" | "reactivate") {
    setBusy(bank.bankRef);
    setNotice(null);
    try {
      const saved = await changeAdminBankCatalogStatus(bank.bankRef, action);
      setBanks((current) => replaceBank(current, saved));
      setArchiveCandidate(null);
      setNotice({
        tone: "success",
        text: action === "archive"
          ? `${saved.name} is archived. Its applications and outcome evidence remain stored.`
          : `${saved.name} is active again. The database readback now includes it in the published catalog.`,
      });
      onMutation?.({
        action: `${action === "archive" ? "Archived" : "Reactivated"} lender ${saved.name}`,
        risk: action === "archive" ? "High" : "Review",
        target: `bank_catalog.${saved.bankRef}`,
      });
    } catch (error) {
      setNotice({ tone: "warning", text: catalogError(error, action) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Panel
        className="mb-5"
        title="Lender catalog management"
        description="Admin edits and visibility decisions remain over the nightly VAULT row, so the next sync cannot erase them. Archive never deletes applications or outcome evidence."
        trailing={<Button disabled={displayedState !== "ready" || busy !== null} onClick={() => { setNotice(null); setEditor(emptyEditor()); }} size="sm"><Plus aria-hidden />Add bank</Button>}
      >
        {notice ? (
          <div aria-live="polite" className={notice.tone === "success"
            ? "mb-4 rounded-lg border border-[color-mix(in_srgb,var(--consumer-positive),transparent_74%)] bg-[color-mix(in_srgb,var(--consumer-positive),transparent_92%)] px-3 py-2 text-xs leading-5 text-[var(--consumer-positive)]"
            : "mb-4 rounded-lg border border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_68%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_55%)] px-3 py-2 text-xs leading-5 text-[var(--consumer-warning-ink)]"}
          >{notice.text}</div>
        ) : null}

        {displayedState === "disabled" ? <EmptyState title="Catalog controls unavailable" description="The governed Bank Vault catalog route is not enabled on this deployment. No edit controls are active." /> : null}
        {displayedState === "loading" ? <p className="py-8 text-sm text-muted-foreground">Loading the complete lender catalog, including archived rows.</p> : null}
        {displayedState === "failed" ? <EmptyState title="Catalog could not be loaded" description="No empty-catalog claim is shown because the governed catalog read failed." /> : null}
        {displayedState === "ready" ? (
          <>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="relative block min-w-0 flex-1 sm:max-w-xs">
                <span className="sr-only">Search managed banks</span>
                <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="min-h-11 pl-8" onChange={(event) => setQuery(event.target.value)} placeholder="Search managed banks" value={query} />
              </label>
              <BrandSelect ariaLabel="Catalog visibility" className="min-w-44" onValueChange={setVisibility} options={["All visibility", "Active", "Archived"]} value={visibility} />
              <span className="text-xs text-muted-foreground sm:ml-auto"><span className="tabular-nums">{activeCount}</span> active · <span className="tabular-nums">{archivedCount}</span> archived</span>
            </div>

            {filtered.length === 0 ? <EmptyState title="No matching banks" description="Change the search or visibility filter; no catalog row was removed." /> : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <Table className="min-w-[980px]">
                    <TableHeader><TableRow><TableHead>Bank</TableHead><TableHead>Origin</TableHead><TableHead>Visibility</TableHead><TableHead>Products</TableHead><TableHead>Evidence</TableHead><TableHead>Updated</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>{filtered.map((bank) => (
                      <TableRow key={bank.bankRef}>
                        <TableCell><p className="font-semibold">{bank.name}</p><p className="mt-1 font-mono text-[0.68rem] text-muted-foreground">{bank.bankRef}</p></TableCell>
                        <TableCell><div className="flex flex-wrap gap-1"><StatusPill tone={bank.source === "manual" ? "info" : "neutral"}>{sourceLabel(bank.source)}</StatusPill>{bank.hasOverride ? <StatusPill tone="warning">Admin override</StatusPill> : null}</div></TableCell>
                        <TableCell><StatusPill tone={bank.isActive ? "success" : "neutral"}>{bank.isActive ? "Active" : "Archived"}</StatusPill></TableCell>
                        <TableCell className="max-w-64 text-xs leading-5">{bank.products.length ? bank.products.join(", ") : "No products recorded"}</TableCell>
                        <TableCell>{bank.outcomeReferenced ? <StatusPill tone="warning">Referenced</StatusPill> : <span className="text-xs text-muted-foreground">No application or outcome reference</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" }).format(new Date(bank.updatedAt))}</TableCell>
                        <TableCell className="text-right"><div className="flex justify-end gap-1"><Button aria-label={`Edit ${bank.name}`} disabled={busy !== null} onClick={() => { setNotice(null); setEditor(editorFor(bank)); }} size="sm" variant="outline">Edit</Button>{bank.isActive ? <Button aria-label={`Archive ${bank.name}`} disabled={busy !== null} onClick={() => setArchiveCandidate(bank)} size="sm" variant="ghost"><Archive aria-hidden />Archive</Button> : <Button aria-label={`Reactivate ${bank.name}`} disabled={busy !== null} onClick={() => { void changeStatus(bank, "reactivate"); }} size="sm" variant="ghost"><RotateCcw aria-hidden />Reactivate</Button>}</div></TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </div>
                <div className="divide-y divide-border md:hidden">{filtered.map((bank) => (
                  <article className="py-4 first:pt-0 last:pb-0" key={bank.bankRef}>
                    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{bank.name}</h3><p className="mt-1 font-mono text-[0.68rem] text-muted-foreground">{bank.bankRef}</p></div><StatusPill tone={bank.isActive ? "success" : "neutral"}>{bank.isActive ? "Active" : "Archived"}</StatusPill></div>
                    <div className="mt-3 flex flex-wrap gap-1"><StatusPill tone={bank.source === "manual" ? "info" : "neutral"}>{sourceLabel(bank.source)}</StatusPill>{bank.hasOverride ? <StatusPill tone="warning">Admin override</StatusPill> : null}{bank.outcomeReferenced ? <StatusPill tone="warning">Referenced</StatusPill> : null}</div>
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">{bank.products.length ? bank.products.join(", ") : "No products recorded"}</p>
                    <div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy !== null} onClick={() => { setNotice(null); setEditor(editorFor(bank)); }} variant="outline">Edit</Button>{bank.isActive ? <Button disabled={busy !== null} onClick={() => setArchiveCandidate(bank)} variant="outline">Archive</Button> : <Button disabled={busy !== null} onClick={() => { void changeStatus(bank, "reactivate"); }} variant="outline">Reactivate</Button>}</div>
                  </article>
                ))}</div>
              </>
            )}
          </>
        ) : null}
      </Panel>

      <Dialog onOpenChange={(open) => { if (!open && busy === null) setEditor(null); }} open={editor !== null}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editor?.originalRef === null ? "Add bank" : `Edit ${editor?.name || "bank"}`}</DialogTitle>
            <DialogDescription>Every value below becomes operator-visible catalog content. Score floors, time-in-business rules, raw source markup, and provider-only fields are rejected.</DialogDescription>
          </DialogHeader>
          {editor ? (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs font-medium">Bank reference<Input aria-label="Bank reference" autoCapitalize="none" className="mt-1 min-h-11 font-mono" disabled={editor.originalRef !== null || busy !== null} maxLength={63} onChange={(event) => setEditor((current) => current ? { ...current, bankRef: event.target.value.toLowerCase() } : current)} placeholder="example-bank" spellCheck={false} value={editor.bankRef} /></label>
              <label className="text-xs font-medium">Bank name<Input aria-label="Bank name" className="mt-1 min-h-11" disabled={busy !== null} maxLength={200} onChange={(event) => setEditor((current) => current ? { ...current, name: event.target.value } : current)} value={editor.name} /></label>
              <label className="text-xs font-medium md:col-span-2">Products, separated by commas<Input aria-label="Bank products" className="mt-1 min-h-11" disabled={busy !== null} onChange={(event) => setEditor((current) => current ? { ...current, products: event.target.value } : current)} placeholder="Business credit card, Term loan" value={editor.products} /></label>
              <label className="text-xs font-medium">Bureau pulls<Input aria-label="Bureau pulls" className="mt-1 min-h-11" disabled={busy !== null} maxLength={200} onChange={(event) => setEditor((current) => current ? { ...current, bureauPulls: event.target.value } : current)} value={editor.bureauPulls} /></label>
              <label className="text-xs font-medium">Source updated date<Input aria-label="Source updated date" className="mt-1 min-h-11" disabled={busy !== null} onChange={(event) => setEditor((current) => current ? { ...current, sourceUpdatedAt: event.target.value } : current)} type="date" value={editor.sourceUpdatedAt} /></label>
              <label className="text-xs font-medium md:col-span-2">Qualification summary<Textarea aria-label="Qualification summary" className="mt-1" disabled={busy !== null} maxLength={500} onChange={(event) => setEditor((current) => current ? { ...current, qualificationSummary: event.target.value } : current)} value={editor.qualificationSummary} /></label>

              <label className="text-xs font-medium">Application channel<BrandSelect ariaLabel="Application channel" className="mt-1 w-full" disabled={busy !== null} onValueChange={(value) => setEditor((current) => current ? { ...current, channelType: value as CatalogEditor["channelType"], channelValue: value === "In person" || value === "Not recorded" ? "" : current.channelValue } : current)} options={CHANNEL_OPTIONS} value={editor.channelType} /></label>
              <label className="text-xs font-medium">Channel URL or phone<Input aria-label="Channel URL or phone" className="mt-1 min-h-11" disabled={busy !== null || editor.channelType === "In person" || editor.channelType === "Not recorded"} maxLength={500} onChange={(event) => setEditor((current) => current ? { ...current, channelValue: event.target.value } : current)} placeholder={editor.channelType === "Online" ? "https://..." : editor.channelType === "Phone" ? "+1 800 555 0100" : "Not used for this channel"} value={editor.channelValue} /></label>

              <label className="text-xs font-medium">Checking required<BrandSelect ariaLabel="Checking required" className="mt-1 w-full" disabled={busy !== null} onValueChange={(value) => setEditor((current) => current ? { ...current, checkingRequired: value as CatalogEditor["checkingRequired"] } : current)} options={BOOLEAN_OPTIONS} value={editor.checkingRequired} /></label>
              <label className="text-xs font-medium">Minimum checking deposit (dollars)<Input aria-label="Minimum checking deposit in dollars" className="mt-1 min-h-11 tabular-nums" disabled={busy !== null} inputMode="decimal" onChange={(event) => setEditor((current) => current ? { ...current, checkingDepositDollars: event.target.value } : current)} placeholder="1000.00" value={editor.checkingDepositDollars} /></label>
              <label className="text-xs font-medium md:col-span-2">Checking seasoning<Input aria-label="Checking seasoning" className="mt-1 min-h-11" disabled={busy !== null} maxLength={200} onChange={(event) => setEditor((current) => current ? { ...current, checkingSeasoning: event.target.value } : current)} placeholder="90 days" value={editor.checkingSeasoning} /></label>

              <label className="text-xs font-medium">Relationship manager required<BrandSelect ariaLabel="Relationship manager required" className="mt-1 w-full" disabled={busy !== null} onValueChange={(value) => setEditor((current) => current ? { ...current, relationshipManagerRequired: value as CatalogEditor["relationshipManagerRequired"] } : current)} options={BOOLEAN_OPTIONS} value={editor.relationshipManagerRequired} /></label>
              <label className="text-xs font-medium">Relationship manager tip<Input aria-label="Relationship manager tip" className="mt-1 min-h-11" disabled={busy !== null} maxLength={240} onChange={(event) => setEditor((current) => current ? { ...current, relationshipManagerTip: event.target.value } : current)} value={editor.relationshipManagerTip} /></label>

              <div className="md:col-span-2">
                <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium">Application questions</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The four standing questions are retained exactly; add only lender-specific questions.</p></div><Button disabled={busy !== null || editor.extraQuestions.length >= 46} onClick={() => setEditor((current) => current ? { ...current, extraQuestions: [...current.extraQuestions, { id: "", label: "", responseBasis: "" }] } : current)} size="sm" type="button" variant="outline"><Plus aria-hidden />Add question</Button></div>
                <div className="mt-3 rounded-lg border border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">Included automatically: {STANDING_APPLICATION_QUESTIONS.map((question) => question.label).join(" · ")}</div>
                <div className="mt-3 space-y-3">{editor.extraQuestions.map((question, index) => (
                  <div className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto]" key={`${index}-${question.id}`}>
                    <label className="text-xs font-medium">Question ID<Input aria-label={`Question ${index + 1} ID`} autoCapitalize="none" className="mt-1 min-h-11 font-mono" disabled={busy !== null} maxLength={64} onChange={(event) => setEditor((current) => current ? { ...current, extraQuestions: current.extraQuestions.map((entry, entryIndex) => entryIndex === index ? { ...entry, id: event.target.value.toLowerCase() } : entry) } : current)} placeholder="requested-amount" spellCheck={false} value={question.id} /></label>
                    <label className="text-xs font-medium">Label<Input aria-label={`Question ${index + 1} label`} className="mt-1 min-h-11" disabled={busy !== null} maxLength={200} onChange={(event) => setEditor((current) => current ? { ...current, extraQuestions: current.extraQuestions.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry) } : current)} value={question.label} /></label>
                    <Button aria-label={`Remove question ${index + 1}`} className="self-end" disabled={busy !== null} onClick={() => setEditor((current) => current ? { ...current, extraQuestions: current.extraQuestions.filter((_, entryIndex) => entryIndex !== index) } : current)} size="icon" type="button" variant="ghost"><X aria-hidden /></Button>
                    <label className="text-xs font-medium md:col-span-3">Response basis<Textarea aria-label={`Question ${index + 1} response basis`} className="mt-1" disabled={busy !== null} maxLength={500} onChange={(event) => setEditor((current) => current ? { ...current, extraQuestions: current.extraQuestions.map((entry, entryIndex) => entryIndex === index ? { ...entry, responseBasis: event.target.value } : entry) } : current)} value={question.responseBasis} /></label>
                  </div>
                ))}</div>
              </div>
            </div>
          ) : null}
          <DialogFooter><Button disabled={busy !== null} onClick={() => setEditor(null)} variant="outline">Cancel</Button><Button disabled={busy !== null || !editor?.bankRef.trim() || !editor?.name.trim()} onClick={() => { void saveEditor(); }}>{busy !== null ? "Saving" : editor?.originalRef === null ? "Create bank" : "Save changes"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => { if (!open && busy === null) setArchiveCandidate(null); }} open={archiveCandidate !== null}>
        <DialogContent>
          <DialogHeader><DialogTitle>Archive {archiveCandidate?.name}?</DialogTitle><DialogDescription>This removes the lender from operator catalog reads. The source row, applications, outcome aggregates, and audit evidence remain stored, and an admin can reactivate it later.</DialogDescription></DialogHeader>
          {archiveCandidate?.outcomeReferenced ? <p className="rounded-lg border border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_68%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_55%)] px-3 py-2 text-xs leading-5 text-[var(--consumer-warning-ink)]">This lender is referenced by an application or outcome aggregate. Archive is available; hard deletion is not.</p> : null}
          <DialogFooter><Button disabled={busy !== null} onClick={() => setArchiveCandidate(null)} variant="outline">Cancel</Button><Button disabled={busy !== null || archiveCandidate === null} onClick={() => { if (archiveCandidate) void changeStatus(archiveCandidate, "archive"); }}>Archive bank</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
