import { PathError } from "./paths";

export function apiError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export function pathErrorResponse(err: unknown): Response {
  if (err instanceof PathError) return apiError(err.status, err.message);
  console.error(err);
  return apiError(500, "Terjadi kesalahan di server.");
}

/** Set by server.ts from the socket address; any value sent by the client is overwritten there. */
export function clientIp(request: Request): string {
  return request.headers.get("x-yshare-ip") ?? "unknown";
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
