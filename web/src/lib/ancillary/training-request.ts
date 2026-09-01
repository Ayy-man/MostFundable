import type { TrainingInput } from "./trainings.ts";
import { TRAINING_SOURCE_MAX_BYTES, type TrainingSourceInput } from "./training-source-contract.ts";

export type PlatformTrainingForm = Readonly<{
  input: TrainingInput;
  sourceFile: File | null;
}>;

const CONTENT_FIELDS = ["audience", "body", "title", "videoUrl"] as const;
const ALLOWED_FIELDS = [...CONTENT_FIELDS, "sourceFile"] as const;

function oneText(form: FormData, name: string): string | null {
  const values = form.getAll(name);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
}

export function parsePlatformTrainingForm(
  form: FormData,
  sourceRequired: boolean,
): PlatformTrainingForm | null {
  const names = [...form.keys()];
  if (names.some((name) => !ALLOWED_FIELDS.includes(name as (typeof ALLOWED_FIELDS)[number]))) return null;

  const audience = oneText(form, "audience");
  const body = oneText(form, "body");
  const title = oneText(form, "title");
  const videoUrl = oneText(form, "videoUrl");
  if ((audience !== "client" && audience !== "operator")
      || body === null
      || title === null
      || videoUrl === null) return null;

  const sourceValues = form.getAll("sourceFile");
  if (sourceValues.length > 1 || (sourceRequired && sourceValues.length !== 1)) return null;
  const sourceFile = sourceValues.length === 0 ? null : sourceValues[0];
  if (sourceFile !== null && !(sourceFile instanceof File)) return null;

  return Object.freeze({
    input: Object.freeze({ audience, body, title, videoUrl }),
    sourceFile,
  });
}

export async function trainingSourceInputFromFile(file: File): Promise<TrainingSourceInput> {
  if (file.size < 1 || file.size > TRAINING_SOURCE_MAX_BYTES) {
    throw new Error("TRAINING_SOURCE_SIZE_INVALID");
  }
  return Object.freeze({
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type,
  });
}
