export const TRAINING_SOURCE_MAX_BYTES = 6 * 1024 * 1024;

export const TRAINING_SOURCE_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;

export type TrainingSourceMimeType = (typeof TRAINING_SOURCE_MIME_TYPES)[number];

export type TrainingSourceInput = Readonly<{
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}>;

export type ValidatedTrainingSource = Readonly<{
  bytes: Uint8Array;
  fileName: string;
  mimeType: TrainingSourceMimeType;
  sizeBytes: number;
}>;

const EXTENSION_BY_MIME: Readonly<Record<TrainingSourceMimeType, string>> = {
  "application/msword": "doc",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

function sourceError(code: string): never {
  throw new Error(code);
}

function isTrainingSourceMimeType(value: string): value is TrainingSourceMimeType {
  return TRAINING_SOURCE_MIME_TYPES.includes(value as TrainingSourceMimeType);
}

function safeSourceFileName(value: string, extension: string): string {
  const normalized = value.normalize("NFKC").trim();
  const suffix = `.${extension}`;
  if (!normalized.toLowerCase().endsWith(suffix)) sourceError("TRAINING_SOURCE_TYPE_INVALID");

  const rawStem = normalized.slice(0, -suffix.length);
  const available = 120 - suffix.length;
  const stem = rawStem
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, available)
    .replace(/[._-]+$/g, "");
  if (!stem) sourceError("TRAINING_SOURCE_NAME_INVALID");
  return `${stem}${suffix}`;
}

export function validateTrainingSource(input: TrainingSourceInput): ValidatedTrainingSource {
  if (!isTrainingSourceMimeType(input.mimeType)) sourceError("TRAINING_SOURCE_TYPE_INVALID");
  if (!(input.bytes instanceof Uint8Array)
      || input.bytes.byteLength < 1
      || input.bytes.byteLength > TRAINING_SOURCE_MAX_BYTES) {
    sourceError("TRAINING_SOURCE_SIZE_INVALID");
  }

  const fileName = safeSourceFileName(input.fileName, EXTENSION_BY_MIME[input.mimeType]);
  return Object.freeze({
    bytes: input.bytes,
    fileName,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
  });
}

export function trainingSourceAccept(): string {
  return ".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
}
