import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { getState } from "@/lib/state";

/** POST /api/auth/logout */
export async function POST(request: NextRequest) {
  const id = request.cookies.get(SESSION_COOKIE)?.value;
  if (id) getState().sessions.delete(id);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
