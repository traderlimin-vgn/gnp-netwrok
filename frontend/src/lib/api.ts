// Typed fetch layer over the FastAPI backend. Base is the relative "/api" prefix so the
// same code works in dev (Vite proxies /api → :8001) and behind a single origin in prod.
const BASE = "/api";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type JsonBody = unknown;

async function request<T>(method: string, path: string, body?: JsonBody): Promise<T> {
  // Auth rides the httpOnly session cookie; X-Requested-With is the CSRF guard the backend checks.
  const headers: Record<string, string> = { "X-Requested-With": "gmp" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: JsonBody) => request<T>("POST", path, body ?? null);
export const apiPut = <T>(path: string, body?: JsonBody) => request<T>("PUT", path, body ?? null);
export const apiPatch = <T>(path: string, body?: JsonBody) =>
  request<T>("PATCH", path, body ?? null);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);

export async function apiUpload(file: File): Promise<{ url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE}/uploads`, { method: "POST", body: fd, headers: { "X-Requested-With": "gmp" } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res.json();
}

/** Human-readable message from an ApiError (FastAPI detail string / list / {code,message}). */
export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    const d = (e.body as { detail?: unknown } | null)?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x: { msg?: string; loc?: unknown[] }) => `${(x.loc ?? []).slice(-1)}: ${x.msg}`).join("; ");
    if (d && typeof d === "object" && "message" in d) return String((d as { message: string }).message);
    return `Permintaan gagal (${e.status})`;
  }
  return "Tidak dapat terhubung ke server";
}
