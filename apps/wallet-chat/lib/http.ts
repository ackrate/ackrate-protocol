import { NextResponse } from "next/server";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
};

export function jsonError(error: unknown, status = 400): NextResponse {
  const message = error instanceof Error ? error.message : "request failed";
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function boundedJson(request: Request, maxBytes = 128 * 1024): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error("request body is too large");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("request body is too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

export async function boundedResponseJson(response: Response, maxBytes = 128 * 1024): Promise<unknown> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) throw new Error("merchant response exceeded the application limit");
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("merchant response exceeded the application limit");
    }
    chunks.push(value);
  }
  const data = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(data);
  } catch {
    throw new Error("merchant returned invalid JSON");
  }
}
