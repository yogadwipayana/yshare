import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { apiError } from "./http";
import { getState, type Session } from "./state";

export const SESSION_COOKIE = "ys_session";

const PIN_WINDOW_MS = 60_000;
const PIN_MAX_PER_IP = 5;
const PIN_MAX_GLOBAL = 30;

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createSession(ip: string, userAgent: string): Session {
  const { sessions, config } = getState();
  const now = Date.now();
  const session: Session = {
    id: crypto.randomBytes(32).toString("base64url"),
    createdAt: now,
    expiresAt: now + config.auth.sessionTtlMs,
    ip,
    userAgent,
  };
  sessions.set(session.id, session);
  return session;
}

export function setSessionCookie(response: NextResponse, session: Session): void {
  response.cookies.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor((session.expiresAt - Date.now()) / 1000),
    // No `secure`: yshare is served over plain HTTP on the LAN.
  });
}

export function isAuthenticated(request: NextRequest): boolean {
  const { config, sessions } = getState();
  if (!config.auth.enabled) return true;

  const id = request.cookies.get(SESSION_COOKIE)?.value;
  if (!id) return false;
  const session = sessions.get(id);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return false;
  }
  return true;
}

/** Returns a 401 response when the request has no valid session, otherwise null. */
export function requireSession(request: NextRequest): Response | null {
  return isAuthenticated(request) ? null : apiError(401, "Sesi habis. Silakan masuk lagi.");
}

function recent(timestamps: number[], now: number): number[] {
  return timestamps.filter((t) => now - t < PIN_WINDOW_MS);
}

/** Seconds until this IP may try again, or 0 if it may try now. */
export function pinRetryAfter(ip: string): number {
  const state = getState();
  const now = Date.now();
  const forIp = recent(state.pinFailures.get(ip) ?? [], now);
  state.pinFailures.set(ip, forIp);
  state.pinFailuresGlobal = recent(state.pinFailuresGlobal, now);

  const blockedBy =
    forIp.length >= PIN_MAX_PER_IP ? forIp : state.pinFailuresGlobal.length >= PIN_MAX_GLOBAL ? state.pinFailuresGlobal : null;
  if (!blockedBy) return 0;
  return Math.max(1, Math.ceil((blockedBy[0] + PIN_WINDOW_MS - now) / 1000));
}

export function recordPinFailure(ip: string): void {
  const state = getState();
  const now = Date.now();
  state.pinFailures.set(ip, [...(state.pinFailures.get(ip) ?? []), now]);
  state.pinFailuresGlobal.push(now);
}
