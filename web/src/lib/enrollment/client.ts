// Browser-safe boundary: keep every server, provider, and database import out.
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function requestJson<T>(
  path: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<ApiResult<T>> {
  try {
    const response = await fetcher(path, init);
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: unknown; message?: unknown } }
      | T
      | null;

    if (!response.ok) {
      const error = (payload as { error?: { code?: unknown; message?: unknown } } | null)
        ?.error;
      return {
        code:
          typeof error?.code === "string" ? error.code : `http_${response.status}`,
        message:
          typeof error?.message === "string"
            ? error.message
            : "Something went wrong. Try that step again.",
        ok: false,
      };
    }

    return { data: payload as T, ok: true };
  } catch {
    return {
      code: "network",
      message: "Could not reach the server. Check your connection and try again.",
      ok: false,
    };
  }
}

export async function postJson<T>(
  path: string,
  body: unknown,
  fetcher: Fetcher = fetch,
): Promise<ApiResult<T>> {
  return requestJson<T>(
    path,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    fetcher,
  );
}

export async function getJson<T>(
  path: string,
  fetcher: Fetcher = fetch,
): Promise<ApiResult<T>> {
  return requestJson<T>(path, { method: "GET" }, fetcher);
}
