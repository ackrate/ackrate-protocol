import { Networks, rpc } from "@stellar/stellar-sdk";
import { c, log } from "../ui.js";
import {
  acknowledgeCompletedSettlement,
  classifyMissingSettlement,
  clearPendingSettlement,
  demoRecoveryDirectory,
  loadPendingSettlement,
  markSettlementCompleted,
  settlementDirectory,
} from "../settlement-store.js";

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const explorer = (network: "testnet" | "mainnet", hash: string) =>
  `https://stellar.expert/explorer/${network === "mainnet" ? "public" : "testnet"}/tx/${hash}`;

export async function runSettlementReconcile(): Promise<void> {
  const loaded = await loadPendingSettlement();
  if (loaded.kind === "none") {
    log.info("no prepared payment is pending");
    return;
  }
  if (loaded.kind === "empty") {
    log.err("journal claim has incomplete metadata; it may still have a live owner and remains locked", { journal: settlementDirectory() });
    log.info("manual evidence review is required; do not delete the claim or start a replacement payment/demo");
    process.exitCode = 1;
    return;
  }
  if (loaded.kind === "demo-run") {
    const record = loaded.record;
    log.err("reference demo remains locked; settlement alone does not prove accepted delivery", {
      run: record.runId,
      network: record.network,
      contract: record.contractId,
      journal: settlementDirectory(),
      evidence: demoRecoveryDirectory(record.mandateId),
    });
    if (record.mandateId) log.info("registered mandate", { mandate: record.mandateId });
    if (record.origin) log.info("original bound delivery origin", { origin: record.origin });
    for (const hash of [record.registrationTx, record.allowanceTx]) {
      if (hash) console.log(c.dim(`  ${explorer(record.network, hash)}`));
    }
    log.info("confirm the original process has stopped, then manually reconcile and recover the exact retained receipts and application outcomes; do not repay, retarget proofs, delete evidence, or use payment acknowledgment to unlock this demo; automatic resume is not implemented");
    process.exitCode = 1;
    return;
  }
  if (loaded.kind === "legacy-demo") {
    log.err("legacy reference-demo evidence requires manual exact-receipt recovery");
    for (const item of loaded.evidence) {
      log.info(item.reason, { evidence: item.directory });
      for (const hash of item.transactionHashes) log.info("retained transaction hash", { tx: hash });
    }
    log.info("preserve the original stores and delivery origin; do not start a replacement demo or clear these records with payment acknowledgment; automatic resume is not implemented");
    process.exitCode = 1;
    return;
  }

  if (loaded.kind === "completed") {
    const hash = loaded.record.pending.txHash;
    log.chain("prepared payment succeeded and remains durably locked", { tx: short(hash) });
    console.log(c.dim(`  ${explorer(loaded.record.network, hash)}`));
    log.info(`after you durably accept this result, run \`ackrate settlement acknowledge ${hash}\``);
    return;
  }

  const { pending, source, contractId, network, rpcUrl } = loaded.record;
  log.step("reconciling exact prepared transaction", {
    tx: short(pending.txHash),
    source,
    contract: `${contractId.slice(0, 6)}…${contractId.slice(-4)}`,
  });

  const server = new rpc.Server(rpcUrl);
  let response;
  try {
    const identity = await server.getNetwork();
    const expectedPassphrase = network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
    if (identity.passphrase !== expectedPassphrase) {
      throw new Error("RPC network identity does not match the durable settlement journal");
    }
    response = await server.getTransaction(pending.txHash);
  } catch (error) {
    log.err("RPC reconciliation failed; pending state retained", {
      reason: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
    return;
  }

  if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    await markSettlementCompleted(pending.txHash);
    log.chain("prepared payment succeeded; durable acknowledgment is required", { tx: short(pending.txHash) });
    console.log(c.dim(`  ${explorer(network, pending.txHash)}`));
    log.info(`after you durably accept this result, run \`ackrate settlement acknowledge ${pending.txHash}\``);
    return;
  }
  if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
    await clearPendingSettlement(pending.txHash);
    log.warn("prepared payment finalized as failed; journal cleared");
    console.log(c.dim(`  ${explorer(network, pending.txHash)}`));
    return;
  }

  const decision = classifyMissingSettlement(pending, response);
  if (decision === "expired") {
    await clearPendingSettlement(pending.txHash);
    log.ok("transaction validity window expired with complete retained RPC history; no payment landed");
    return;
  }
  if (decision === "invalid-history") {
    log.err("RPC history bounds are missing or invalid; journal retained for manual evidence review");
  } else if (decision === "history-pruned") {
    log.err("RPC history no longer covers the full transaction window; journal retained for manual evidence review");
  } else {
    log.warn("transaction is still within its validity/history window; journal retained");
  }
  process.exitCode = 1;
}

export async function runSettlementAcknowledge(txHash: string): Promise<void> {
  try {
    await acknowledgeCompletedSettlement(txHash);
  } catch (error) {
    log.err("completed payment was not acknowledged", {
      reason: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
    return;
  }
  log.ok("completed payment acknowledged; a new payment may now be prepared", {
    tx: short(txHash),
  });
}
