// A class supports same-module instanceof checks; the name fallback covers duplicated bundles.
export class AuthError extends Error {
  readonly code: "unauthenticated" | "forbidden";
  readonly status: 401 | 403;

  constructor(
    status: 401 | 403,
    code: "unauthenticated" | "forbidden",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "AuthError";
    this.status = status;
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return (
    error instanceof AuthError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "AuthError")
  );
}
