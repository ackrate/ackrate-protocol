import { readFile, writeFile } from "node:fs/promises";
import {
  combineSignedEnvelopes,
  createSigningRequest,
  verifySigningRequest,
} from "../ops-signing-request.js";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function runOpsCreate(
  xdrPath: string,
  manifestPath: string,
  outPath: string,
): Promise<void> {
  const xdr = (await readFile(xdrPath, "utf8")).trim();
  const request = createSigningRequest(xdr, await readJson(manifestPath));
  await writeFile(outPath, `${JSON.stringify(request, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(`created immutable request ${request.requestId}`);
  console.log(`transaction ${request.transaction.hash}`);
  console.log(`effect ${request.transaction.effect.target} ${request.transaction.effect.function}`);
}

export async function runOpsVerify(requestPath: string): Promise<void> {
  const request = verifySigningRequest(await readJson(requestPath));
  console.log(`verified request ${request.requestId}`);
  console.log(`transaction ${request.transaction.hash}`);
  console.log(`source ${request.transaction.source}`);
  console.log(`effect ${request.transaction.effect.target} ${request.transaction.effect.function}`);
}

export async function runOpsCombine(
  requestPath: string,
  signedPaths: string[],
  outPath: string,
): Promise<void> {
  const request = await readJson(requestPath);
  const signed = await Promise.all(
    signedPaths.map(async (path) => (await readFile(path, "utf8")).trim()),
  );
  const combined = combineSignedEnvelopes(request, signed);
  await writeFile(outPath, `${combined.signedEnvelopeXdr}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(`assembled request ${combined.requestId}`);
  console.log(`transaction ${combined.transactionHash}`);
  console.log(`signers ${combined.signerPublicKeys.join(",")}`);
}
