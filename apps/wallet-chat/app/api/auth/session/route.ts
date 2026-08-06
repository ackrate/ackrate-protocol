import { loadAppConfig } from "@/lib/app-config";
import { jsonError, NO_STORE_HEADERS } from "@/lib/http";
import { cookieOptions, readSession, requireSameOrigin, sessionCookieName } from "@/lib/security";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const config = loadAppConfig();
    const session = config.sessionSecret
      ? await readSession(config.sessionSecret, config.public.network)
      : { authenticated: false, address: null, network: null, expiresAt: null };
    return NextResponse.json({ ok: true, session }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return jsonError(error, 500);
  }
}

export async function DELETE() {
  try {
    await requireSameOrigin();
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
    response.cookies.set(sessionCookieName(), "", cookieOptions(0));
    return response;
  } catch (error) {
    return jsonError(error, 400);
  }
}
