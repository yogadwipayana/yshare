import { NextResponse, type NextRequest } from "next/server";
import { createSession, pinRetryAfter, recordPinFailure, safeEqual, setSessionCookie } from "@/lib/auth";
import { apiError, clientIp, readJson } from "@/lib/http";
import { getState } from "@/lib/state";

/** POST /api/auth/pin { pin } — log in with the 6-digit PIN shown in the server terminal. */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const wait = pinRetryAfter(ip);
  if (wait > 0) {
    return Response.json(
      { error: `Terlalu banyak percobaan. Coba lagi dalam ${wait} detik.` },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  const body = await readJson<{ pin?: unknown }>(request);
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  if (!/^\d{6}$/.test(pin)) return apiError(400, "PIN harus 6 digit angka.");

  if (!safeEqual(pin, getState().pin)) {
    recordPinFailure(ip);
    console.warn(`[auth] PIN salah dari ${ip}`);
    return apiError(401, "PIN salah.");
  }

  const session = createSession(ip, request.headers.get("user-agent") ?? "");
  console.log(`[auth] perangkat masuk dengan PIN: ${ip}`);
  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, session);
  return response;
}
