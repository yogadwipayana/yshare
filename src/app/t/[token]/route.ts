import { connection, NextResponse, type NextRequest } from "next/server";
import { createSession, safeEqual, setSessionCookie } from "@/lib/auth";
import { clientIp } from "@/lib/http";
import { getState } from "@/lib/state";

/** GET /t/{token} — the link inside the QR code. Logs the device in and opens the app. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const valid = safeEqual(token, getState().token);

  // Relative Location: the absolute URL Next.js builds may not match the address the phone used.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: valid ? "/" : "/?link=expired", "Referrer-Policy": "no-referrer" },
  });
  if (valid) {
    const ip = clientIp(request);
    setSessionCookie(response, createSession(ip, request.headers.get("user-agent") ?? ""));
    console.log(`[auth] perangkat masuk lewat QR: ${ip}`);
  }
  return response;
}
