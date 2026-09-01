import { AppError } from "./errors.ts";

export async function readEnrollmentJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AppError("invalid_payload", "The request body must be valid JSON.");
    }
    throw error;
  }
}
