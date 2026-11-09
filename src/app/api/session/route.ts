import { connection, type NextRequest } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getState } from "@/lib/state";
import type { SessionInfo } from "@/lib/types";

/** GET /api/session — is this browser logged in, and the upload settings it needs. */
export async function GET(request: NextRequest) {
  await connection();
  const { config } = getState();
  const authenticated = isAuthenticated(request);
  const info: SessionInfo = {
    authenticated,
    authEnabled: config.auth.enabled,
    settings: authenticated
      ? {
          maxFileSize: config.upload.maxFileSize,
          parallel: config.upload.parallel,
          conflictDefault: config.upload.conflictDefault,
          blockedExtensions: config.upload.blockedExtensions,
        }
      : undefined,
  };
  return Response.json(info, { headers: { "Cache-Control": "no-store" } });
}
