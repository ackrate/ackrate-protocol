import { loadAppConfig } from "@/lib/app-config";
import { jsonError, NO_STORE_HEADERS } from "@/lib/http";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = loadAppConfig().public;
    return NextResponse.json({
      ok: config.ready,
      releaseState: config.releaseState,
      network: config.network,
      sourceCommit: config.sourceCommit,
      releaseFingerprint: config.releaseFingerprint,
      durableState: config.durableState,
      blockers: config.blockers,
    }, { status: config.ready ? 200 : 503, headers: NO_STORE_HEADERS });
  } catch (error) {
    return jsonError(error, 503);
  }
}
