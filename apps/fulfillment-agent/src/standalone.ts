/** Dedicated process entrypoint. CLI bundles import server.ts, never this file. */
import { readFileSync } from "node:fs";
import { Buffer } from "buffer";
import { resolveBoundAckrateInterruptedDelivery } from "@ackrate/express-middleware";
import { mainnetNetworkFromDeploymentManifest } from "@ackrate/stellar";
import { FileBoundRedemptionStore } from "./redemption-store.js";
import { startServer, type FulfillmentAppOptions } from "./server.js";

async function main(): Promise<void> {
  const merchant = (process.env.ACKRATE_MERCHANT ?? "").trim();
  const sourceAccount = (process.env.ACKRATE_READ_SOURCE ?? merchant).trim();
  const challengeSecret = (process.env.ACKRATE_CHALLENGE_SECRET ?? "").trim();
  const redemptionPath = (process.env.ACKRATE_REDEMPTION_STORE ?? "").trim();
  const publicOrigin = (process.env.ACKRATE_PUBLIC_ORIGIN ?? "").trim() || undefined;
  const network = (process.env.ACKRATE_NETWORK ?? "testnet").trim();
  let mainnetOptions: Pick<FulfillmentAppOptions, "networkConfig" | "asset" | "network" | "amount"> = {};

  if (network !== "testnet" && network !== "mainnet") {
    throw new Error("ACKRATE_NETWORK must be testnet or mainnet");
  }
  if (network === "mainnet") {
    const manifestPath = (process.env.ACKRATE_DEPLOYMENT_MANIFEST ?? "").trim();
    const amount = (process.env.ACKRATE_SOURCE_PRICE ?? "").trim();
    if (!manifestPath) throw new Error("ACKRATE_DEPLOYMENT_MANIFEST is required on mainnet");
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 1) {
      throw new Error("ACKRATE_SOURCE_PRICE must be an explicit positive mainnet USDC amount no greater than 1");
    }
    const networkConfig = mainnetNetworkFromDeploymentManifest(
      JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
    );
    mainnetOptions = {
      networkConfig,
      asset: networkConfig.settlementAsset.contractId,
      network: "stellar-mainnet",
      amount,
    };
  }
  if (Buffer.byteLength(challengeSecret, "utf8") < 32) {
    throw new Error("ACKRATE_CHALLENGE_SECRET must contain at least 32 bytes for restart-safe fulfillment");
  }
  if (!redemptionPath) {
    throw new Error("ACKRATE_REDEMPTION_STORE must name a private durable redemption file");
  }

  const redemptionStore = new FileBoundRedemptionStore(redemptionPath);
  for (const record of await redemptionStore.listExecuting()) {
    await resolveBoundAckrateInterruptedDelivery({ redemptionStore, record });
  }
  const { url } = await startServer({
    merchant,
    sourceAccount,
    challengeSecret,
    audience: publicOrigin,
    redemptionStore,
    ...mainnetOptions,
    port: Number(process.env.PORT ?? 8402),
  });
  console.log(`fulfillment-agent listening on ${url}  merchant=${merchant}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
