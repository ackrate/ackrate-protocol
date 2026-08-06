import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Keypair, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { cookies, headers } from "next/headers";
import type { NetworkName, SessionView } from "./types";

const TOKEN_VERSION = 1;
export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const SESSION_TTL_SECONDS = 60 * 60;

interface TokenEnvelope {
  v: 1;
  kind: "challenge" | "session";
  address: string;
  network: NetworkName;
  iat: number;
  exp: number;
  jti: string;
  txHash?: string;
}

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function sealToken(payload: TokenEnvelope, secret: string): string {
  const body = encode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function openToken(
  token: string | undefined,
  secret: string,
  expectedKind: TokenEnvelope["kind"],
  now = Math.floor(Date.now() / 1_000),
): TokenEnvelope | null {
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenEnvelope;
    if (
      payload.v !== TOKEN_VERSION
      || payload.kind !== expectedKind
      || typeof payload.address !== "string"
      || (payload.network !== "testnet" && payload.network !== "mainnet")
      || !Number.isSafeInteger(payload.iat)
      || !Number.isSafeInteger(payload.exp)
      || payload.iat > now + 30
      || payload.exp <= now
      || payload.exp - payload.iat > (expectedKind === "challenge" ? CHALLENGE_TTL_SECONDS : SESSION_TTL_SECONDS)
      || !/^[0-9a-f]{32}$/.test(payload.jti)
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createChallengeToken(
  address: string,
  network: NetworkName,
  txHash: string,
  secret: string,
  now = Math.floor(Date.now() / 1_000),
): { token: string; payload: TokenEnvelope } {
  const payload: TokenEnvelope = {
    v: TOKEN_VERSION,
    kind: "challenge",
    address,
    network,
    iat: now,
    exp: now + CHALLENGE_TTL_SECONDS,
    jti: randomBytes(16).toString("hex"),
    txHash,
  };
  return { token: sealToken(payload, secret), payload };
}

export function createSessionToken(
  address: string,
  network: NetworkName,
  secret: string,
  now = Math.floor(Date.now() / 1_000),
): { token: string; payload: TokenEnvelope } {
  const payload: TokenEnvelope = {
    v: TOKEN_VERSION,
    kind: "session",
    address,
    network,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    jti: randomBytes(16).toString("hex"),
  };
  return { token: sealToken(payload, secret), payload };
}

export function verifySignedChallengeTransaction(
  signedTransactionXdr: string,
  networkPassphrase: string,
  expectedAddress: string,
  expectedHash: string,
): void {
  const parsed = TransactionBuilder.fromXDR(signedTransactionXdr, networkPassphrase);
  if (!(parsed instanceof Transaction)) throw new Error("wallet must sign the exact authentication transaction");
  if (parsed.source !== expectedAddress || parsed.hash().toString("hex") !== expectedHash) {
    throw new Error("signed authentication transaction does not match the issued challenge");
  }
  const verifier = Keypair.fromPublicKey(expectedAddress);
  const valid = parsed.signatures.some((decorated) => verifier.verify(parsed.hash(), decorated.signature()));
  if (!valid) throw new Error("wallet signature could not be verified for the connected account");
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

export function sessionCookieName(): string {
  return secureCookies() ? "__Host-reapp_session" : "reapp_session";
}

export function challengeCookieName(): string {
  return secureCookies() ? "__Host-reapp_challenge" : "reapp_challenge";
}

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: secureCookies(),
  sameSite: "strict" as const,
  path: "/",
  maxAge,
});

export async function requireSameOrigin(): Promise<void> {
  const incoming = await headers();
  const origin = incoming.get("origin");
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
  const proto = incoming.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const expected = process.env.REAPP_APP_ORIGIN?.trim() || (host ? `${proto}://${host}` : null);
  if (!origin || !expected || origin !== expected) {
    throw new Error("cross-origin request rejected");
  }
}

export async function readSession(secret: string, network?: NetworkName): Promise<SessionView> {
  const jar = await cookies();
  const payload = openToken(jar.get(sessionCookieName())?.value, secret, "session");
  if (!payload || (network && payload.network !== network)) {
    return { authenticated: false, address: null, network: null, expiresAt: null };
  }
  return { authenticated: true, address: payload.address, network: payload.network, expiresAt: payload.exp };
}

export async function requireSession(secret: string, network: NetworkName): Promise<Required<SessionView>> {
  const session = await readSession(secret, network);
  if (!session.authenticated || !session.address || !session.network || !session.expiresAt) {
    throw new Error("wallet-authenticated session required");
  }
  return session as Required<SessionView>;
}
