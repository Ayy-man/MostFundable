import { documentForVersion } from "./consent-texts.ts";

export interface SignedAgreementArtifact {
  readonly signedAt: string;
  readonly signerName: string;
  readonly textVersion: string;
  readonly typedSignature: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function agreementFilename(signedAt: string): string {
  const parsed = new Date(signedAt);
  const day = Number.isFinite(parsed.valueOf()) ? parsed.toISOString().slice(0, 10) : "signed";
  return `mostfundable-service-agreement-${day}.html`;
}

export function renderSignedAgreement(artifact: SignedAgreementArtifact): string {
  const document = documentForVersion(artifact.textVersion);
  if (document.key !== "enrollment_agreement") throw new Error("AGREEMENT_VERSION_INVALID");
  const signed = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "long",
    timeZone: "UTC",
  }).format(new Date(artifact.signedAt));
  const paragraphs = document.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.title)}</title>
</head>
<body>
<main>
<h1>${escapeHtml(document.title)}</h1>
<p>Agreement version ${escapeHtml(document.version)} · effective ${escapeHtml(document.effectiveFrom)}</p>
${paragraphs}
<hr>
<h2>Electronic signature</h2>
<dl>
<dt>Signer</dt><dd>${escapeHtml(artifact.signerName)}</dd>
<dt>Typed signature</dt><dd>${escapeHtml(artifact.typedSignature)}</dd>
<dt>Signed</dt><dd>${escapeHtml(signed)} UTC</dd>
</dl>
</main>
</body>
</html>`;
}
