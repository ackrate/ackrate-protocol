"use client";

import { createContext, useContext, useMemo } from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { ArrowUp, ArrowUpRight, Bot, Check, CircleDollarSign, LoaderCircle, TriangleAlert, UserRound } from "lucide-react";

const ExplorerContext = createContext<"testnet" | "public">("testnet");

export function AssistantThread({ mandateId, asset, explorerNetwork }: { mandateId: string; asset: string; explorerNetwork: "testnet" | "public" }) {
  const transport = useMemo(() => new AssistantChatTransport({
    api: "/api/chat",
    body: { mandateId },
    credentials: "same-origin",
  }), [mandateId]);
  const runtime = useChatRuntime({ transport });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ExplorerContext.Provider value={explorerNetwork}>
      <ThreadPrimitive.Root className="thread-root">
        <ThreadPrimitive.Viewport className="thread-viewport">
          <ThreadPrimitive.Empty>
            <div className="chat-empty">
              <div className="agent-orb"><Bot size={22} /></div>
              <p className="eyebrow success">MANDATE ONLINE</p>
              <h3>Your agent has boundaries.</h3>
              <p>Ask for a listed source. Every payment is re-checked and consumed atomically by MandateRegistry.</p>
              <div className="chat-prompt">Try: “Buy the market signal brief and summarize it.”</div>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages
            components={{ UserMessage, AssistantMessage }}
          />
          <div className="composer-wrap">
            <ComposerPrimitive.Root className="composer-root">
              <ComposerPrimitive.Input
                aria-label="Message the REAPP agent"
                className="composer-input"
                placeholder="Ask the agent to purchase a source…"
              />
              <ComposerPrimitive.Send className="composer-send" aria-label="Send message">
                <ArrowUp size={17} />
              </ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
            <p><CircleDollarSign size={12} /> Payments settle in {asset}. The contract—not the model—enforces the mandate.</p>
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
      </ExplorerContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="message-row user-message">
      <div className="message-avatar"><UserRound size={15} /></div>
      <div className="message-bubble"><MessagePrimitive.Parts /></div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="message-row assistant-message">
      <div className="message-avatar"><Bot size={15} /></div>
      <div className="message-bubble">
        <MessagePrimitive.Parts components={{ tools: { by_name: { purchase_source: PurchaseTool } } }} />
      </div>
    </MessagePrimitive.Root>
  );
}

interface PurchaseResult {
  source: { id: string; title: string };
  payment: { status: string; amount: string; asset: string; txHash: string; mandateId: string };
  delivered: unknown;
}

function isPurchaseResult(value: unknown): value is PurchaseResult {
  if (typeof value !== "object" || value === null) return false;
  const payment = (value as { payment?: unknown }).payment;
  return typeof payment === "object" && payment !== null && typeof (payment as { txHash?: unknown }).txHash === "string";
}

function PurchaseTool({ result, isError, args }: ToolCallMessagePartProps<{ sourceId?: string }, unknown>) {
  const explorerNetwork = useContext(ExplorerContext);
  if (isError) {
    return <div className="tool-card tool-error"><TriangleAlert size={15} /><div><strong>Payment stopped safely</strong><p>The request failed before a second payment could be issued.</p></div></div>;
  }
  if (!isPurchaseResult(result)) {
    return <div className="tool-card"><LoaderCircle className="spin" size={15} /><div><strong>Checking mandate + settlement</strong><p>{args.sourceId ? `Preparing ${args.sourceId}` : "Preparing allowlisted source"}</p></div></div>;
  }
  return (
    <div className="tool-card tool-success">
      <span className="tool-check"><Check size={14} /></span>
      <div className="tool-body">
        <strong>{result.source.title}</strong>
        <p>{result.payment.amount} {result.payment.asset} settled through MandateRegistry</p>
        <a href={`https://stellar.expert/explorer/${explorerNetwork}/tx/${result.payment.txHash}`} target="_blank" rel="noreferrer">
          View transaction · {result.payment.txHash.slice(0, 8)}…{result.payment.txHash.slice(-8)} <ArrowUpRight size={12} />
        </a>
      </div>
    </div>
  );
}
