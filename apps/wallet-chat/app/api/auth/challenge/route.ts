import { Account, Operation, StrKey, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { z } from "zod";
import { loadAppConfig } from "@/lib/app-config";
import { boundedJson, jsonError, NO_STORE_HEADERS } from "@/lib/http";
import {
  CHALLENGE_TTL_SECONDS,
  challengeCookieName,
  cookieOptions,
  createChallengeToken,
  requireSameOrigin,
} from "@/lib/security";
import { NextResponse } from "next/server";

const Body = z.object({ address: z.string().refine(StrKey.isValidEd25519PublicKey, "a valid Stellar G-address is required") }).strict();

export async function POST(request: Request) {
  try {
    await requireSameOrigin();
    const config = loadAppConfig();
    if (!config.sessionSecret) throw new Error("wallet authentication is not configured");
    const { address } = Body.parse(await boundedJson(request, 4_096));
    const server = new rpc.Server(config.network.rpcUrl, { allowHttp: config.network.rpcUrl.startsWith("http://") });
    const source = await server.getAccount(address);
    const now = Math.floor(Date.now() / 1_000);
    const transaction = new TransactionBuilder(new Account(address, source.sequenceNumber()), {
      fee: "100",
      networkPassphrase: config.network.networkPassphrase,
    })
      .addOperation(Operation.manageData({
        name: "reapp.auth.v1",
        value: Buffer.from(crypto.randomUUID().replaceAll("-", ""), "hex"),
      }))
      .setTimebounds(now - 30, now + CHALLENGE_TTL_SECONDS)
      .build();
    const challenge = createChallengeToken(
      address,
      config.public.network,
      transaction.hash().toString("hex"),
      config.sessionSecret,
      now,
    );
    const response = NextResponse.json({
      ok: true,
      transactionXdr: transaction.toXDR(),
      expiresAt: challenge.payload.exp,
      statement: "Sign this non-broadcast transaction in LOBSTR to authenticate this browser session.",
    }, { headers: NO_STORE_HEADERS });
    response.cookies.set(challengeCookieName(), challenge.token, cookieOptions(CHALLENGE_TTL_SECONDS));
    return response;
  } catch (error) {
    return jsonError(error, 400);
  }
}
