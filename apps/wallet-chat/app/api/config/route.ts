import { loadAppConfig } from "@/lib/app-config";
import { jsonError, NO_STORE_HEADERS } from "@/lib/http";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, config: loadAppConfig().public }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return jsonError(error, 503);
  }
}
