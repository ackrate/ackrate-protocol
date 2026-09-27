import Link from "next/link";
import { loadAppConfig } from "@/lib/app-config";

export const dynamic = "force-dynamic";

export default function DiagnosticsPage() {
  let config;
  try {
    config = loadAppConfig().public;
  } catch (error) {
    return (
      <main className="shell diagnostic-page">
        <Link href="/" className="brand"><span>A</span> Ackrate</Link>
        <section className="glass diagnostic-card">
          <p className="eyebrow danger">CONFIGURATION REJECTED</p>
          <h1>Release diagnostics</h1>
          <p>{error instanceof Error ? error.message : "Configuration could not be parsed."}</p>
        </section>
      </main>
    );
  }
  const fields = [
    ["SDK profile", `${config.profile.id} · ${config.profile.deployment}`],
    ["Profile fingerprint", config.profile.fingerprint],
    ["Release state", config.releaseState],
    ["Network", config.networkLabel],
    ["Registry", config.mandateRegistryId],
    ["Settlement asset", `${config.asset.code} · ${config.asset.contractId}`],
    ["Wallet path", `${config.wallet.name} · ${config.wallet.signingMode}`],
    ["Durable state", config.durableState ? "configured" : "not configured"],
    ["Application commit", config.sourceCommit ?? "not pinned"],
    ["Release fingerprint", config.releaseFingerprint ?? "testnet / not issued"],
  ];
  return (
    <main className="shell diagnostic-page">
      <Link href="/" className="brand"><span>A</span> Ackrate</Link>
      <section className="glass diagnostic-card">
        <div className="diagnostic-head">
          <div>
            <p className={`eyebrow ${config.ready ? "success" : "danger"}`}>{config.ready ? "GATE OPEN" : "GATE CLOSED"}</p>
            <h1>Release diagnostics</h1>
          </div>
          <Link href="/" className="secondary-button">Back to wallet</Link>
        </div>
        <div className="diagnostic-grid">
          {fields.map(([label, value]) => (
            <div key={label}><span>{label}</span><code>{value}</code></div>
          ))}
        </div>
        {config.blockers.length > 0 && (
          <div className="blockers">
            <strong>Activation blockers</strong>
            <ul>{config.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
          </div>
        )}
        {config.environmentWarnings.length > 0 && (
          <section aria-label="Environment navigation configuration">
            <h2>Environment links</h2>
            <ul>{config.environmentWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </section>
        )}
      </section>
    </main>
  );
}
