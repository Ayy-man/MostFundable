import "server-only";

import { surfacePlainText } from "@/lib/vault/sync";

import type { SessionProfile } from "@/lib/auth/session";
import type { TrackerClient } from "@/lib/tracker/types";
import type { WorkspacePreferences } from "@/lib/portal/preferences";
import type { Application, ApplicationNote, Outcome } from "./types.ts";

interface BankSummary {
  readonly bankRef: string;
  readonly name: string;
  readonly products: readonly string[];
  readonly qualificationSummary: string | null;
  readonly sourceUpdatedAt: string | null;
}

interface BankRow {
  readonly bank_ref: string;
  readonly name: string;
  readonly products: unknown;
  readonly qualification_summary: string | null;
  readonly source_updated_at: string | null;
}

interface BankReadClient {
  from(table: "bank_read_model"): {
    select(columns: string): {
      in(column: "bank_ref", values: readonly string[]): PromiseLike<{
        data: BankRow[] | null;
        error: unknown;
      }>;
    };
  };
}

export interface ConsumerApplicationsDependencies {
  listApplications(clientId: string): Promise<Application[]>;
  listClients(session: SessionProfile): Promise<TrackerClient[]>;
  listNotes(applicationId: string): Promise<ApplicationNote[]>;
  listOutcomes(clientId: string): Promise<Outcome[]>;
  readBanks(bankRefs: readonly string[]): Promise<readonly BankSummary[]>;
  readPreferences(orgId: string): Promise<WorkspacePreferences>;
  requireConsumer(): Promise<SessionProfile>;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" }, status });
}

function accessStatus(error: unknown): 401 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  return error.status === 401 || error.status === 403 ? error.status : null;
}

async function defaults(): Promise<ConsumerApplicationsDependencies> {
  const [{ requireRole }, tracker, applications, portal, { createAdminClient }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/tracker"),
    import("@/lib/applications"),
    import("@/lib/portal/preferences.server"),
    import("@/lib/supabase/admin"),
  ]);
  return {
    listApplications: applications.listApplications,
    listClients: (session) => tracker.listTrackerClients(session, { scope: "all" }),
    listNotes: applications.listNotes,
    listOutcomes: applications.listOutcomes,
    async readBanks(bankRefs) {
      if (bankRefs.length === 0) return [];
      const { data, error } = await (createAdminClient() as unknown as BankReadClient)
        .from("bank_read_model")
        .select("bank_ref,name,products,qualification_summary,source_updated_at")
        .in("bank_ref", [...bankRefs]);
      if (error) throw new Error("CONSUMER_APPLICATION_BANKS_UNAVAILABLE");
      return (data ?? []).flatMap((row) => {
        const name = surfacePlainText(row.name);
        if (typeof row.bank_ref !== "string" || name === null) return [];
        return [{
          bankRef: row.bank_ref,
          name,
          products: Array.isArray(row.products)
            ? row.products.flatMap((product: unknown) => {
                const clean = typeof product === "string" ? surfacePlainText(product) : null;
                return clean === null ? [] : [clean];
              })
            : [],
          qualificationSummary: surfacePlainText(row.qualification_summary),
          sourceUpdatedAt: typeof row.source_updated_at === "string" ? row.source_updated_at : null,
        }];
      });
    },
    readPreferences: portal.readPortalPreferencesForOrg,
    requireConsumer: () => requireRole("consumer"),
  };
}

function presentation(application: Application, preferences: WorkspacePreferences): "details" | "status-only" {
  if (application.visibility === "details") return "details";
  if (application.visibility === "status_only") return "status-only";
  return preferences.portal.applicationVisibility;
}

function compareApplicationSequence(left: Application, right: Application): number {
  const leftAt = Date.parse(left.createdAt);
  const rightAt = Date.parse(right.createdAt);
  if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) {
    return leftAt - rightAt;
  }
  const byTimestamp = left.createdAt.localeCompare(right.createdAt);
  return byTimestamp === 0 ? left.id.localeCompare(right.id) : byTimestamp;
}

export async function handleConsumerApplications(
  supplied?: ConsumerApplicationsDependencies,
): Promise<Response> {
  try {
    const dependencies = supplied ?? await defaults();
    const session = await dependencies.requireConsumer();
    if (session.role !== "consumer" || session.orgId === null) return json({ error: { code: "forbidden" } }, 403);
    const clients = await dependencies.listClients(session);
    if (clients.length !== 1) return json({ error: { code: "client_scope_unavailable" } }, 409);
    const clientId = clients[0].id;
    const [applications, outcomes, preferences] = await Promise.all([
      dependencies.listApplications(clientId),
      dependencies.listOutcomes(clientId),
      dependencies.readPreferences(session.orgId),
    ]);
    const orderedApplications = [...applications].sort(compareApplicationSequence);
    const notes = await Promise.all(orderedApplications.map((application) => dependencies.listNotes(application.id)));
    const shown = orderedApplications.map((application) => presentation(application, preferences));
    const detailRefs = [...new Set(orderedApplications.flatMap((application, index) => shown[index] === "details" ? [application.bankRef] : []))];
    let banks: readonly BankSummary[] = [];
    try { banks = await dependencies.readBanks(detailRefs); } catch { banks = []; }
    const bankByRef = new Map(banks.map((bank) => [bank.bankRef, bank]));
    const outcomeByApplication = new Map<string, Outcome>();
    for (const outcome of outcomes) {
      if (outcome.state === "counted" && !outcomeByApplication.has(outcome.applicationId)) {
        outcomeByApplication.set(outcome.applicationId, outcome);
      }
    }

    return json({
      applications: orderedApplications.map((application, index) => {
        const showsDetails = shown[index] === "details";
        const bank = shown[index] === "details" ? bankByRef.get(application.bankRef) : undefined;
        const outcome = outcomeByApplication.get(application.id);
        return {
          consumerStatus: application.consumerStatus,
          createdAt: application.createdAt,
          id: application.id,
          lender: bank ? {
            name: bank.name,
            products: bank.products,
            qualificationSummary: bank.qualificationSummary,
            sourceUpdatedAt: bank.sourceUpdatedAt,
          } : null,
          notes: notes[index].map((note) => ({
            authorKind: note.authorKind,
            body: note.body,
            createdAt: note.createdAt,
            id: note.id,
          })),
          operatorStatus: application.operatorStatus,
          outcome: outcome ? {
            amountCents: showsDetails ? outcome.amountCents : null,
            createdAt: outcome.createdAt,
            decidedOn: outcome.decidedOn,
            kind: outcome.kind,
            recordedByKind: outcome.recordedByKind,
          } : null,
          presentation: shown[index],
          requestedAmountCents: showsDetails ? application.amountCents : null,
          sequence: index + 1,
          updatedAt: application.updatedAt,
        };
      }),
    });
  } catch (error) {
    const status = accessStatus(error);
    if (status !== null) return json({ error: { code: status === 401 ? "unauthenticated" : "forbidden" } }, status);
    return json({ error: { code: "applications_unavailable" } }, 500);
  }
}
