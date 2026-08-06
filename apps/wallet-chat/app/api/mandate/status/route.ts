import { z } from "zod";
import { loadAppConfig } from "@/lib/app-config";
import { boundedJson, jsonError, NO_STORE_HEADERS } from "@/lib/http";
import { readMandate } from "@/lib/mandate-state";
import { requireSameOrigin, requireSession } from "@/lib/security";
import { NextResponse } from "next/server";

const Body = z.object({ mandateId: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

export async function POST(request: Request) {
  try {
    await requireSameOrigin();
    const config = loadAppConfig();
    if (!config.sessionSecret) throw new Error("wallet authentication is not configured");
    const session = await requireSession(config.sessionSecret, config.public.network);
    if (!session.address) throw new Error("wallet-authenticated session required");
    const { mandateId } = Body.parse(await boundedJson(request, 4_096));
    const mandate = await readMandate(config.network, session.address, mandateId);
    if (mandate.user !== session.address) throw new Error("mandate belongs to a different wallet");
    return NextResponse.json({ ok: true, mandate }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return jsonError(error, 400);
  }
}
