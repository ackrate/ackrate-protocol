"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  ExternalLink,
  Fingerprint,
  LockKeyhole,
  Power,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import type { IntentMandate } from "@ackrate/core";
import { approveWithLobstr, buildMandate, registerWithLobstr, revokeWithLobstr } from "@/lib/mandate-client";
import type { MandateView, SafeAppConfig, SessionView } from "@/lib/types";
import { connectLobstr, signLobstrTransaction } from "@/lib/wallet/lobstr";
import { AssistantThread } from "./assistant-thread";

type Phase = "idle" | "authenticating" | "registering" | "approving" | "active" | "revoking";

interface StoredMandate {
  id: string;
  user: string;
  agent: string;
  merchant: string;
  asset: string;
  maxAmount: string;
  expiry: number;
  decimals: number;
  registrationTx?: string;
  allowanceTx?: string;
  revokeTx?: string;
}

const emptySession: SessionView = { authenticated: false, address: null, network: null, expiresAt: null };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json() as { ok: boolean; error?: string } & T;
  if (!response.ok || !body.ok) throw new Error(body.error ?? `Request failed with HTTP ${response.status}`);
  return body;
}

const short = (value: string | null | undefined, size = 7) => value ? `${value.slice(0, size)}…${value.slice(-size)}` : "Not configured";

function formatUnits(value: string, decimals: number): string {
  const raw = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function storedToIntent(stored: StoredMandate): IntentMandate {
  return {
    ...stored,
    idBuffer: Buffer.from(stored.id, "hex"),
    maxAmount: BigInt(stored.maxAmount),
  };
}

export function WalletChatApp() {
  const [config, setConfig] = useState<SafeAppConfig | null>(null);
  const [session, setSession] = useState<SessionView>(emptySession);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredMandate | null>(null);
  const [mandate, setMandate] = useState<MandateView | null>(null);
  const [budget, setBudget] = useState("3.00");
  const [duration, setDuration] = useState("60");
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMandate = useCallback(async (candidate?: StoredMandate | null) => {
    const current = candidate ?? stored;
    if (!current) return;
    const body = await api<{ mandate: MandateView }>("/api/mandate/status", {
      method: "POST",
      body: JSON.stringify({ mandateId: current.id }),
    });
    setMandate(body.mandate);
    setPhase(body.mandate.status === "Active" ? "active" : "idle");
  }, [stored]);

  useEffect(() => {
    Promise.all([
      api<{ config: SafeAppConfig }>("/api/config"),
      api<{ session: SessionView }>("/api/auth/session"),
    ]).then(([configResult, sessionResult]) => {
      setConfig(configResult.config);
      setSession(sessionResult.session);
      if (sessionResult.session.address) setWalletAddress(sessionResult.session.address);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(() => {
    if (!config || !session.authenticated || !session.address) return;
    const key = `ackrate:mandate:${config.network}:${session.address}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as StoredMandate;
      if (parsed.user !== session.address || !/^[0-9a-f]{64}$/.test(parsed.id)) throw new Error("invalid stored mandate");
      setStored(parsed);
      void refreshMandate(parsed).catch(() => undefined);
    } catch {
      localStorage.removeItem(key);
    }
  }, [config, session, refreshMandate]);

  const saveStored = useCallback((value: StoredMandate) => {
    if (!config) return;
    localStorage.setItem(`ackrate:mandate:${config.network}:${value.user}`, JSON.stringify(value));
    setStored(value);
  }, [config]);

  const connect = async () => {
    if (!config) return;
    setError(null);
    setNotice("Open LOBSTR and approve the connection request.");
    setPhase("authenticating");
    try {
      const address = await connectLobstr();
      setWalletAddress(address);
      setNotice("LOBSTR connected. No transaction was signed or broadcast.");
      setPhase("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setNotice(null);
      setPhase("idle");
    }
  };

  const authenticate = async () => {
    if (!config || !walletAddress) return;
    setError(null);
    setPhase("authenticating");
    try {
      const challenge = await api<{ transactionXdr: string }>("/api/auth/challenge", {
        method: "POST",
        body: JSON.stringify({ address: walletAddress }),
      });
      setNotice("Verify this wallet with a non-broadcast challenge. Nothing will be sent to Mainnet.");
      const signedTransactionXdr = await signLobstrTransaction(challenge.transactionXdr);
      const verified = await api<{ session: SessionView }>("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ signedTransactionXdr }),
      });
      setSession(verified.session);
      setNotice("LOBSTR verified. Your session is bound to this wallet and network.");
      setPhase("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setNotice(null);
      setPhase("idle");
    }
  };

  const activate = async () => {
    if (!config || !session.address || !config.ready) return;
    setError(null);
    try {
      const expiry = Math.floor(Date.now() / 1_000) + Number(duration) * 60;
      const intent = buildMandate(config, session.address, { budget, expiry });
      let next: StoredMandate = {
        id: intent.id,
        user: intent.user,
        agent: intent.agent,
        merchant: intent.merchant,
        asset: intent.asset,
        maxAmount: intent.maxAmount.toString(),
        expiry: intent.expiry,
        decimals: intent.decimals,
      };
      saveStored(next);
      setPhase("registering");
      setNotice("Review and approve the mandate registration in LOBSTR.");
      const registrationTx = await registerWithLobstr(config, intent);
      next = { ...next, registrationTx };
      saveStored(next);
      setPhase("approving");
      setNotice("One final LOBSTR approval: allowance goes to MandateRegistry, never the agent.");
      const allowanceTx = await approveWithLobstr(config, intent);
      next = { ...next, allowanceTx };
      saveStored(next);
      await refreshMandate(next);
      setNotice("Mandate active. The agent can spend only inside the on-chain envelope.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setNotice("The flow stopped safely. Any completed on-chain step is retained for recovery.");
      setPhase("idle");
    }
  };

  const retryAllowance = async () => {
    if (!config || !stored) return;
    setError(null);
    setPhase("approving");
    try {
      const allowanceTx = await approveWithLobstr(config, storedToIntent(stored));
      const next = { ...stored, allowanceTx };
      saveStored(next);
      await refreshMandate(next);
      setNotice("Allowance confirmed. Mandate is ready for the agent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("idle");
    }
  };

  const revoke = async () => {
    if (!config || !stored) return;
    setError(null);
    setPhase("revoking");
    try {
      const revokeTx = await revokeWithLobstr(config, storedToIntent(stored));
      const next = { ...stored, revokeTx };
      saveStored(next);
      await refreshMandate(next);
      setNotice("Mandate revoked on-chain. The agent cannot make another payment.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("active");
    }
  };

  const disconnect = async () => {
    await api("/api/auth/session", { method: "DELETE", body: "{}" }).catch(() => undefined);
    setSession(emptySession);
    setWalletAddress(null);
    setMandate(null);
    setStored(null);
    setPhase("idle");
    setNotice(null);
  };

  const progress = phase === "active" ? 3 : stored?.registrationTx && stored?.allowanceTx ? 3 : stored?.registrationTx ? 2 : walletAddress ? 1 : 0;
  const remaining = mandate && config ? formatUnits(mandate.remaining, config.asset.decimals) : budget;
  const spent = mandate && config ? formatUnits(mandate.spent, config.asset.decimals) : "0";
  const usedPercent = mandate && BigInt(mandate.maxAmount) > 0n
    ? Number((BigInt(mandate.spent) * 10_000n) / BigInt(mandate.maxAmount)) / 100
    : 0;
  const expires = mandate?.expiry ?? stored?.expiry;
  const explorer = config ? `https://stellar.expert/explorer/${config.explorerNetwork}` : "#";

  return (
    <main className="app-frame">
      <div className="aurora" aria-hidden />
      <header className="topbar">
        <Link href="/" className="brand"><span>A</span> Ackrate</Link>
        <div className="topbar-center"><span className="pulse-dot" /> Mandate control room</div>
        <div className="topbar-actions">
          <Link href="/diagnostics" className="nav-link">Diagnostics</Link>
          {walletAddress ? (
            <button className="wallet-pill" onClick={disconnect}><span className="wallet-led" /> {short(walletAddress, 5)} <Power size={13} /></button>
          ) : (
            <button className="wallet-pill" onClick={connect} disabled={!config || phase === "authenticating"}><WalletCards size={14} /> Connect LOBSTR</button>
          )}
        </div>
      </header>

      <section className="hero shell">
        <div>
          <div className="status-chip"><Sparkles size={13} /> CONTRACT-ENFORCED AGENT PAYMENTS</div>
          <h1>Give the agent a budget.<br /><span>Keep the authority.</span></h1>
          <p>Connect without signing. Approve only the mandate actions you choose; MandateRegistry re-checks the agent, merchant, asset, expiry, and remaining budget every time value moves.</p>
        </div>
        <div className="network-card glass">
          <div className="network-card-top">
            <span><Activity size={14} /> NETWORK</span>
            <b className={config?.ready ? "online" : "blocked"}>{config?.ready ? "READY" : "GATED"}</b>
          </div>
          <strong>{config?.networkLabel ?? "Loading network…"}</strong>
          <code>{short(config?.mandateRegistryId, 9)}</code>
          <div className="network-meta"><ShieldCheck size={14} /> Manifest-bound configuration</div>
        </div>
      </section>

      <section className="steps shell" aria-label="Activation progress">
        {[
          [1, "Wallet", "Connect—no transaction"],
          [2, "Mandate", "Register + approve"],
          [3, "Agent", "Chat + settle"],
        ].map(([number, title, caption], index) => (
          <div className={`step ${progress >= Number(number) ? "complete" : ""}`} key={String(title)}>
            <span>{progress > Number(number) ? <Check size={15} /> : number}</span>
            <div><strong>{title}</strong><small>{caption}</small></div>
            {index < 2 && <ChevronRight className="step-chevron" size={17} />}
          </div>
        ))}
      </section>

      <section className="workspace shell">
        <aside className="control-column">
          <div className="panel glass wallet-panel">
            <div className="panel-heading"><div><p className="eyebrow">01 · WALLET</p><h2>LOBSTR authority</h2></div><div className={`icon-tile ${walletAddress ? "live" : ""}`}><WalletCards size={19} /></div></div>
            {session.authenticated ? (
              <div className="connected-state">
                <div className="identity-line"><span className="wallet-led" /><div><small>Authenticated account</small><code>{short(session.address, 9)}</code></div><ShieldCheck size={18} /></div>
                <p><LockKeyhole size={13} /> Session verified by a signed, non-broadcast Stellar transaction.</p>
              </div>
            ) : walletAddress ? (
              <div className="connected-state">
                <div className="identity-line"><span className="wallet-led" /><div><small>Connected account</small><code>{short(walletAddress, 9)}</code></div><WalletCards size={18} /></div>
                <p><ShieldCheck size={13} /> Connection is read-only. No Mainnet transaction was signed or broadcast.</p>
                <button className="primary-button" onClick={authenticate} disabled={phase === "authenticating"}><LockKeyhole size={16} /> {phase === "authenticating" ? "Waiting for LOBSTR…" : "Verify wallet—no broadcast"}</button>
              </div>
            ) : (
              <>
                <p className="panel-copy">Connect the LOBSTR Signer Extension to display your public address. Connecting does not create, sign, or broadcast a transaction.</p>
                <button className="primary-button" onClick={connect} disabled={!config || phase === "authenticating"}><WalletCards size={16} /> {phase === "authenticating" ? "Waiting for LOBSTR…" : "Connect LOBSTR"}</button>
              </>
            )}
          </div>

          <div className={`panel glass mandate-panel ${!session.authenticated ? "muted" : ""}`}>
            <div className="panel-heading"><div><p className="eyebrow">02 · MANDATE</p><h2>Set the boundary</h2></div><div className={`icon-tile ${mandate?.status === "Active" ? "live" : ""}`}><Fingerprint size={19} /></div></div>
            {!mandate || mandate.status !== "Active" ? (
              <>
                <label>Maximum spend<div className="money-input"><span>{config?.asset.code ?? "ASSET"}</span><input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" disabled={!session.authenticated || Boolean(stored?.registrationTx)} /></div></label>
                <label>Expires after<select value={duration} onChange={(event) => setDuration(event.target.value)} disabled={!session.authenticated || Boolean(stored?.registrationTx)}><option value="30">30 minutes</option><option value="60">1 hour</option><option value="360">6 hours</option><option value="1440">24 hours</option></select></label>
                <div className="scope-box"><div><span>Agent</span><code>{short(config?.agentAddress, 6)}</code></div><div><span>Merchant</span><code>{config?.merchant.name ?? "Not configured"}</code></div><div><span>Asset</span><code>{config?.asset.code ?? "—"}</code></div></div>
                {stored?.registrationTx && !stored.allowanceTx ? (
                  <button className="primary-button" onClick={retryAllowance} disabled={phase === "approving"}><RefreshCw size={16} /> {phase === "approving" ? "Waiting for LOBSTR…" : "Finish allowance approval"}</button>
                ) : (
                  <button className="primary-button" onClick={activate} disabled={!session.authenticated || !config?.ready || phase === "registering" || phase === "approving"}><Zap size={16} /> {phase === "registering" ? "Registering mandate…" : phase === "approving" ? "Approving allowance…" : "Sign & activate mandate"}</button>
                )}
                <p className="fine-print"><ShieldCheck size={12} /> Allowance is granted only to MandateRegistry—not the agent or this app.</p>
              </>
            ) : (
              <div className="mandate-active">
                <div className="active-banner"><span><Check size={15} /></span><div><small>On-chain status</small><strong>Active mandate</strong></div></div>
                <div className="mandate-id"><span>Mandate ID</span><code>{short(mandate.id, 9)}</code></div>
                <button className="danger-button" onClick={revoke} disabled={phase === "revoking"}><X size={15} /> {phase === "revoking" ? "Waiting for LOBSTR…" : "Revoke authority"}</button>
              </div>
            )}
          </div>
        </aside>

        <section className="panel glass chat-panel">
          <div className="chat-head">
            <div className="agent-title"><div className="agent-orb"><Bot size={21} /></div><div><p className="eyebrow">03 · CONSUMER AGENT</p><h2>Research console</h2></div></div>
            <div className={`agent-status ${mandate?.status === "Active" ? "online" : ""}`}><span /> {mandate?.status === "Active" ? "MANDATE ONLINE" : "AWAITING MANDATE"}</div>
          </div>
          {mandate?.status === "Active" && config ? (
            <AssistantThread mandateId={mandate.id} asset={config.asset.code} explorerNetwork={config.explorerNetwork} />
          ) : (
            <div className="chat-locked">
              <div className="lock-rings"><LockKeyhole size={27} /></div>
              <p className="eyebrow">AGENT LOCKED</p>
              <h3>Authority comes first.</h3>
              <p>Connect LOBSTR, register the mandate, and approve the contract allowance. Chat unlocks only after the on-chain state reads Active.</p>
            </div>
          )}
        </section>

        <aside className="evidence-column">
          <div className="panel glass authority-card">
            <div className="panel-heading"><div><p className="eyebrow">LIVE AUTHORITY</p><h2>Spending envelope</h2></div><CircleDollarSign size={20} /></div>
            <div className="remaining"><span>Remaining</span><strong>{remaining} <small>{config?.asset.code ?? ""}</small></strong></div>
            <div className="meter"><span style={{ width: `${Math.min(100, usedPercent)}%` }} /></div>
            <div className="budget-row"><div><span>Spent</span><strong>{spent}</strong></div><div><span>Budget</span><strong>{mandate && config ? formatUnits(mandate.maxAmount, config.asset.decimals) : budget}</strong></div></div>
            <div className="authority-list">
              <div><Clock3 size={14} /><span>Expires</span><strong>{expires ? new Date(expires * 1_000).toLocaleString() : "Not signed"}</strong></div>
              <div><Fingerprint size={14} /><span>Sequence</span><strong>{mandate?.seq ?? 0}</strong></div>
              <div><Database size={14} /><span>State</span><strong>{config?.durableState ? "Durable" : "Local preview"}</strong></div>
            </div>
          </div>

          <div className="panel glass proof-card">
            <div className="panel-heading"><div><p className="eyebrow">CHAIN EVIDENCE</p><h2>Verifiable by default</h2></div><ExternalLink size={18} /></div>
            <a href={config?.mandateRegistryId ? `${explorer}/contract/${config.mandateRegistryId}` : "#"} target="_blank" rel="noreferrer"><span>MandateRegistry</span><code>{short(config?.mandateRegistryId, 6)}</code><ArrowUpRight size={14} /></a>
            {stored?.registrationTx && <a href={`${explorer}/tx/${stored.registrationTx}`} target="_blank" rel="noreferrer"><span>Registration</span><code>{short(stored.registrationTx, 6)}</code><ArrowUpRight size={14} /></a>}
            {stored?.allowanceTx && <a href={`${explorer}/tx/${stored.allowanceTx}`} target="_blank" rel="noreferrer"><span>Allowance</span><code>{short(stored.allowanceTx, 6)}</code><ArrowUpRight size={14} /></a>}
            {stored?.revokeTx && <a href={`${explorer}/tx/${stored.revokeTx}`} target="_blank" rel="noreferrer"><span>Revocation</span><code>{short(stored.revokeTx, 6)}</code><ArrowUpRight size={14} /></a>}
          </div>

          {config && !config.ready && (
            <div className="panel gate-card"><TriangleAlert size={18} /><div><strong>Release gate closed</strong><p>{config.blockers.length} configuration item{config.blockers.length === 1 ? "" : "s"} remain. No mainnet fallback is permitted.</p></div></div>
          )}
        </aside>
      </section>

      {(notice || error) && <div className={`toast ${error ? "error" : ""}`}><span>{error ? <TriangleAlert size={16} /> : <Check size={16} />}</span><p>{error ?? notice}</p><button onClick={() => { setError(null); setNotice(null); }} aria-label="Dismiss"><X size={14} /></button></div>}

      <footer className="footer shell"><div><ShieldCheck size={15} /> Protocol-enforced spending limits</div><p>SDK, model, and interface are untrusted. MandateRegistry decides whether value moves.</p><Link href="/diagnostics">Release diagnostics <ArrowUpRight size={13} /></Link></footer>
    </main>
  );
}
