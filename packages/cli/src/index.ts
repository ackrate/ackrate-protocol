#!/usr/bin/env node
/**
 * ackrate — CLI for the Ackrate MandateRegistry. The contract is the source of truth;
 * this tool is a thin, untrusted client over the published @ackrate packages.
 */
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runSetup } from "./commands/setup.js";
import { runMandateCreate } from "./commands/mandate.js";
import { runPay } from "./commands/pay.js";
import { runDemo } from "./commands/demo.js";
import { runSettlementAcknowledge, runSettlementReconcile } from "./commands/reconcile.js";
import { CLI_VERSION } from "./version.js";
import {
  runOpsCombine,
  runOpsCreate,
  runOpsVerify,
} from "./commands/ops.js";

const program = new Command();

program
  .name("ackrate")
  .description("Agent payments on Stellar, enforced on-chain by the Ackrate MandateRegistry.")
  .version(CLI_VERSION);

program
  .command("init")
  .description("scaffold a project in the current directory (writes ackrate.config.json)")
  .option("--network <network>", "testnet or mainnet", "testnet")
  .option("--manifest <path>", "verified Mainnet deployment manifest")
  .option("--user-signer <identity>", "named Stellar CLI identity for the mandate user")
  .option("--agent-signer <identity>", "named Stellar CLI identity for direct payments")
  .option("--merchant <address>", "merchant Stellar G-account")
  .option("--price <amount>", "default price (Mainnet: USDC)")
  .option("--budget <amount>", "default mandate limit (Mainnet: USDC)")
  .option("--agent-secret-env <name>", "environment-variable name supplied by a secret manager for bound-v2 proofs")
  .option("-f, --force", "overwrite an existing ackrate.config.json")
  .action((opts) => runInit(opts));

program
  .command("setup")
  .description("prepare actors: testnet creates burners; Mainnet performs read-only readiness checks")
  .option("-f, --force", "regenerate fresh keys, overwriting existing credentials")
  .action((opts) => runSetup(opts));

const mandate = program.command("mandate").description("manage AP2 mandates");
mandate
  .command("create")
  .description("register an AP2 mandate on-chain and approve the SEP-41 allowance")
  .option("-b, --budget <amount>", "mandate cap (default: from ackrate.config.json)")
  .option("-e, --expiry <seconds>", "seconds until the mandate expires", "3600")
  .option("-f, --force", "replace an existing stored mandate")
  .option("--confirm-real-usdc", "acknowledge irreversible Mainnet USDC authorization")
  .action((opts) => runMandateCreate(opts));

program
  .command("pay")
  .description("make an agent-signed payment against the active mandate (budget enforced on-chain)")
  .argument("[amount]", "amount to pay (default: unlockPrice from ackrate.config.json)")
  .option("--confirm-real-usdc", "acknowledge an irreversible Mainnet USDC payment")
  .action((amount, options) => runPay(amount, options));

const settlement = program.command("settlement").description("inspect crash-safe payment state");
settlement
  .command("reconcile")
  .description("query the exact prepared transaction hash before allowing another payment")
  .action(() => runSettlementReconcile());
settlement
  .command("acknowledge")
  .description("acknowledge one exact durably recorded successful payment")
  .argument("<tx-hash>", "the exact 64-character lowercase transaction hash")
  .action((txHash) => runSettlementAcknowledge(txHash));

const ops = program
  .command("ops")
  .description("coordinate exact 2-of-3 authority requests without handling secrets");
ops
  .command("create")
  .description("bind one unsigned transaction XDR to an immutable signing request")
  .requiredOption("--xdr <path>", "file containing unsigned transaction-envelope XDR")
  .requiredOption("--manifest <path>", "public 2-of-3 authority manifest")
  .requiredOption("--out <path>", "new request JSON file; refuses to overwrite")
  .action((options) => runOpsCreate(options.xdr, options.manifest, options.out));
ops
  .command("verify")
  .description("independently verify a request ID, XDR, source, network, and effect")
  .requiredOption("--request <path>", "immutable request JSON file")
  .action((options) => runOpsVerify(options.request));
ops
  .command("combine")
  .description("verify and combine exactly two independently signed envelopes")
  .requiredOption("--request <path>", "immutable request JSON file")
  .requiredOption("--signed <path...>", "exactly two single-signature XDR files")
  .requiredOption("--out <path>", "new two-signature XDR file; refuses to overwrite")
  .action((options) => runOpsCombine(options.request, options.signed, options.out));

program
  .command("demo")
  .description("run the reference research-agent payment flow on testnet or explicitly configured mainnet")
  .argument("[target]", "which demo to run; omit to list available demos")
  .option("--network <network>", "testnet or mainnet", "testnet")
  .option("--manifest <path>", "verified mainnet deployment manifest JSON")
  .option("--user-signer <identity>", "Stellar CLI identity for the mandate user")
  .option("--agent-signer <identity>", "Stellar CLI identity for the payment agent")
  .option("--agent-secret-env <name>", "environment-variable name supplied by a secret manager for bound-v2 proofs")
  .option("--merchant <address>", "mainnet merchant G-account")
  .option("--budget <usdc>", "explicit real-USDC mandate budget")
  .option("--price <usdc>", "explicit real-USDC price per source")
  .option("--confirm-real-usdc", "acknowledge that mainnet payments are irreversible and spend real USDC")
  .action((target, options) => runDemo(target, options));

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
