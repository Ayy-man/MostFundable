import "server-only";

import {
  agreementFilename,
  renderSignedAgreement,
  type SignedAgreementArtifact,
} from "./agreement-download.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "X-Content-Type-Options": "nosniff",
};

export interface AgreementDownloadDependencies {
  read(enrollmentId: string, consumerProfileId: string): Promise<SignedAgreementArtifact | null>;
  requireConsumer(): Promise<{ readonly id: string }>;
}

async function readAgreement(
  enrollmentId: string,
  consumerProfileId: string,
): Promise<SignedAgreementArtifact | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const { data: enrollment, error: enrollmentError } = await db
    .from("enrollments")
    .select("client_id, esig_doc_id")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (enrollmentError) throw new Error("AGREEMENT_ENROLLMENT_READ_FAILED");
  if (enrollment === null) return null;

  const { data: client, error: clientError } = await db
    .from("clients")
    .select("id")
    .eq("id", enrollment.client_id)
    .eq("consumer_profile_id", consumerProfileId)
    .maybeSingle();
  if (clientError) throw new Error("AGREEMENT_CLIENT_READ_FAILED");
  if (client === null) return null;

  const { data: signature, error: signatureError } = await db
    .from("esignatures")
    .select("client_id, document_kind, text_version, signer_name, typed_signature, signed_at")
    .eq("id", enrollment.esig_doc_id)
    .eq("client_id", enrollment.client_id)
    .maybeSingle();
  if (signatureError) throw new Error("AGREEMENT_SIGNATURE_READ_FAILED");
  if (signature === null || signature.document_kind !== "enrollment_agreement") return null;
  return Object.freeze({
    signedAt: signature.signed_at,
    signerName: signature.signer_name,
    textVersion: signature.text_version,
    typedSignature: signature.typed_signature,
  });
}

async function defaults(): Promise<AgreementDownloadDependencies> {
  const { requireRole } = await import("@/lib/auth/session");
  return {
    read: readAgreement,
    async requireConsumer() { return requireRole("consumer"); },
  };
}

function error(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status, headers: privateHeaders });
}

function accessStatus(value: unknown): 401 | 403 | null {
  if (typeof value !== "object" || value === null || !("status" in value)) return null;
  const status = (value as { status?: unknown }).status;
  return status === 401 || status === 403 ? status : null;
}

export async function handleAgreementDownload(
  enrollmentId: string,
  supplied?: AgreementDownloadDependencies,
): Promise<Response> {
  const dependencies = supplied ?? await defaults();
  try {
    const session = await dependencies.requireConsumer();
    if (!UUID.test(enrollmentId)) return error("invalid_request", "Enrollment id must be a UUID.", 400);
    const artifact = await dependencies.read(enrollmentId, session.id);
    if (artifact === null) return error("agreement_not_found", "No signed service agreement is recorded for this enrollment.", 404);
    const html = renderSignedAgreement(artifact);
    return new Response(html, {
      headers: {
        ...privateHeaders,
        "Content-Disposition": `attachment; filename="${agreementFilename(artifact.signedAt)}"`,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (caught) {
    const status = accessStatus(caught);
    if (status !== null) return error(status === 401 ? "session_required" : "role_forbidden", status === 401 ? "Sign in to download your agreement." : "This account cannot download a consumer agreement.", status);
    return error("agreement_unavailable", "The signed agreement could not be downloaded right now.", 500);
  }
}
