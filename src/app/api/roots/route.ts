import { connection, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getState } from "@/lib/state";
import { freeSpace } from "@/lib/upload";

/** GET /api/roots — the folders the admin allowed in yshare.config.yaml. Real paths stay hidden. */
export async function GET(request: NextRequest) {
  await connection();
  const denied = requireSession(request);
  if (denied) return denied;

  const roots = await Promise.all(
    getState().config.roots.map(async (root) => ({
      id: root.id,
      name: root.name,
      space: await freeSpace(root.realPath),
    })),
  );
  return Response.json({ roots });
}
