/**
 * Official Mainnet V2 binding, generated offline with Stellar CLI 26.1.0 from
 * published WASM SHA-256 982809197d35d44c7b0fce6bd117fb2fec09b728c64c146c1f803b01faacff62.
 * Contract spec bytes SHA-256 4c5a232e101007aab8a9b3c717fec3720a65ceb454be2754f7deeb2f95737e6f.
 * Do not edit ABI entries by hand; regenerate from the verified release artifact.
 */
import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import { DEPLOYMENTS } from "./deployments.js";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const networks = Object.freeze({
  mainnet: Object.freeze({ networkPassphrase: "Public Global Stellar Network ; September 2015", contractId: DEPLOYMENTS.mainnet.mandateRegistryId }),
} as const);

export const Errors = {
  1: {message:"AlreadyExists"},
  2: {message:"NotFound"},
  4: {message:"MandateExpired"},
  5: {message:"MandateRevoked"},
  6: {message:"BudgetExceeded"},
  7: {message:"MerchantOutOfScope"},
  8: {message:"BadSequence"},
  9: {message:"InvalidAmount"},
  10: {message:"Paused"},
  14: {message:"UpgradeRequiresPause"},
  15: {message:"AssetNotAllowed"},
  16: {message:"MandateTooLong"},
  17: {message:"SequenceExhausted"},
  18: {message:"AssetPolicyRequiresPause"},
  19: {message:"InvalidState"},
  20: {message:"NoPendingAdmin"},
  21: {message:"AssetOutOfScope"}
}

export type Status = {tag: "Active", values: void} | {tag: "Revoked", values: void} | {tag: "Exhausted", values: void};


export interface Mandate {
  /**
 * The only principal permitted to call `execute_payment`.
 */
agent: string;
  /**
 * SEP-41 token contract used for settlement.
 */
asset: string;
  /**
 * Ledger-close timestamp after which the mandate is invalid.
 */
expiry: u64;
  /**
 * Total amount authorized by the mandate.
 */
max_amount: i128;
  /**
 * The only allowed payment recipient.
 */
merchant: string;
  /**
 * Monotonic replay guard for successful payments.
 */
seq: u32;
  /**
 * Amount consumed so far; always between zero and `max_amount`.
 */
spent: i128;
  status: Status;
  /**
 * Principal authorizing the mandate and token allowance.
 */
user: string;
  /**
 * Credential commitment and caller-supplied uniqueness source. The
 * on-chain mandate identifier is a domain-separated hash over this value
 * and every immutable mandate term.
 */
vc_hash: Buffer;
}










export interface Client {
  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Emergency stop for the sole money-moving path.
   */
  pause: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Restore the money-moving path after an emergency stop.
   */
  unpause: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Replace this contract's WASM at the same address. Upgrades require the
   * administrator's authorization and an already-paused money path.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Current operational administrator.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a is_paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read the emergency-stop state without authorization.
   */
  is_paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_mandate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Non-value-moving accessor for inspection and off-chain preflight. A
   * successful read may refresh the mandate's persistence horizon.
   */
  get_mandate: ({mandate_id}: {mandate_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Mandate>>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accept a pending handoff. Authorized by the proposed administrator.
   */
  accept_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Propose a recoverable authority handoff. The current administrator keeps
   * control until the candidate proves control by calling `accept_admin`.
   */
  propose_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a revoke_mandate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * User withdrawal of consent. Authorized by the bound user.
   */
  revoke_mandate: ({mandate_id}: {mandate_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_payment transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The only money path. State consumption and transfer are atomic; a token
   * failure reverts the stored `spent`, `seq`, and status changes.
   */
  execute_payment: ({mandate_id, amount, expected_seq}: {mandate_id: Buffer, amount: i128, expected_seq: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_asset_allowed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether an asset is currently admitted for validation and settlement.
   */
  is_asset_allowed: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a register_mandate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Store a user-authorized mandate. Mutable fields are initialized by the
   * contract so the caller cannot seed a spent balance, sequence, or status.
   */
  register_mandate: ({user, agent, merchant, asset, max_amount, expiry, vc_hash}: {user: string, agent: string, merchant: string, asset: string, max_amount: i128, expiry: u64, vc_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a validate_mandate transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Non-value-moving preview. It may refresh TTLs; the authoritative checks
   * are repeated by `execute_payment` against current stored state.
   */
  validate_mandate: ({mandate_id, amount, expected_seq, merchant, asset}: {mandate_id: Buffer, amount: i128, expected_seq: u32, merchant: string, asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a derive_mandate_id transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deterministically derive the domain-separated identifier returned by
   * `register_mandate` without depending on any x402 wire representation.
   */
  derive_mandate_id: ({user, agent, merchant, asset, max_amount, expiry, vc_hash}: {user: string, agent: string, merchant: string, asset: string, max_amount: i128, expiry: u64, vc_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a get_pending_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Candidate administrator waiting to accept a proposed handoff.
   */
  get_pending_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a set_asset_allowed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Change the reviewed-token admission policy. Policy changes are allowed
   * only while the money path is paused; removal also blocks existing
   * mandates from executing against that asset.
   */
  set_asset_allowed: ({asset, allowed}: {asset: string, allowed: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_schema_version transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Current durable storage schema. Money-path methods reject a missing or
   * unexpected version so an incompatible upgrade cannot fail open.
   */
  get_schema_version: (options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, initial_asset}: {admin: string, initial_asset: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, initial_asset}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAC5FbWVyZ2VuY3kgc3RvcCBmb3IgdGhlIHNvbGUgbW9uZXktbW92aW5nIHBhdGguAAAAAAAFcGF1c2UAAAAAAAAAAAAAAA==",
        "AAAAAAAAADZSZXN0b3JlIHRoZSBtb25leS1tb3ZpbmcgcGF0aCBhZnRlciBhbiBlbWVyZ2VuY3kgc3RvcC4AAAAAAAd1bnBhdXNlAAAAAAAAAAAA",
        "AAAAAAAAAIZSZXBsYWNlIHRoaXMgY29udHJhY3QncyBXQVNNIGF0IHRoZSBzYW1lIGFkZHJlc3MuIFVwZ3JhZGVzIHJlcXVpcmUgdGhlCmFkbWluaXN0cmF0b3IncyBhdXRob3JpemF0aW9uIGFuZCBhbiBhbHJlYWR5LXBhdXNlZCBtb25leSBwYXRoLgAAAAAAB3VwZ3JhZGUAAAAAAQAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAACJDdXJyZW50IG9wZXJhdGlvbmFsIGFkbWluaXN0cmF0b3IuAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAADRSZWFkIHRoZSBlbWVyZ2VuY3ktc3RvcCBzdGF0ZSB3aXRob3V0IGF1dGhvcml6YXRpb24uAAAACWlzX3BhdXNlZAAAAAAAAAAAAAABAAAAAQ==",
        "AAAAAAAAAIJOb24tdmFsdWUtbW92aW5nIGFjY2Vzc29yIGZvciBpbnNwZWN0aW9uIGFuZCBvZmYtY2hhaW4gcHJlZmxpZ2h0LiBBCnN1Y2Nlc3NmdWwgcmVhZCBtYXkgcmVmcmVzaCB0aGUgbWFuZGF0ZSdzIHBlcnNpc3RlbmNlIGhvcml6b24uAAAAAAALZ2V0X21hbmRhdGUAAAAAAQAAAAAAAAAKbWFuZGF0ZV9pZAAAAAAD7gAAACAAAAABAAAD6QAAB9AAAAAHTWFuZGF0ZQAAAAAD",
        "AAAAAAAAAENBY2NlcHQgYSBwZW5kaW5nIGhhbmRvZmYuIEF1dGhvcml6ZWQgYnkgdGhlIHByb3Bvc2VkIGFkbWluaXN0cmF0b3IuAAAAAAxhY2NlcHRfYWRtaW4AAAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAIBBdG9taWNhbGx5IGVzdGFibGlzaGVzIHRoZSBpbml0aWFsIGFkbWluaXN0cmF0b3IgZHVyaW5nIGRlcGxveW1lbnQuCkNvbnN0cnVjdG9ycyBydW4gb25seSBvbmNlOyBXQVNNIHVwZ3JhZGVzIGRvIG5vdCByZXJ1biB0aGVtLgAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAA1pbml0aWFsX2Fzc2V0AAAAAAAAEwAAAAA=",
        "AAAAAAAAAI5Qcm9wb3NlIGEgcmVjb3ZlcmFibGUgYXV0aG9yaXR5IGhhbmRvZmYuIFRoZSBjdXJyZW50IGFkbWluaXN0cmF0b3Iga2VlcHMKY29udHJvbCB1bnRpbCB0aGUgY2FuZGlkYXRlIHByb3ZlcyBjb250cm9sIGJ5IGNhbGxpbmcgYGFjY2VwdF9hZG1pbmAuAAAAAAANcHJvcG9zZV9hZG1pbgAAAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAADlVc2VyIHdpdGhkcmF3YWwgb2YgY29uc2VudC4gQXV0aG9yaXplZCBieSB0aGUgYm91bmQgdXNlci4AAAAAAAAOcmV2b2tlX21hbmRhdGUAAAAAAAEAAAAAAAAACm1hbmRhdGVfaWQAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAIZUaGUgb25seSBtb25leSBwYXRoLiBTdGF0ZSBjb25zdW1wdGlvbiBhbmQgdHJhbnNmZXIgYXJlIGF0b21pYzsgYSB0b2tlbgpmYWlsdXJlIHJldmVydHMgdGhlIHN0b3JlZCBgc3BlbnRgLCBgc2VxYCwgYW5kIHN0YXR1cyBjaGFuZ2VzLgAAAAAAD2V4ZWN1dGVfcGF5bWVudAAAAAADAAAAAAAAAAptYW5kYXRlX2lkAAAAAAPuAAAAIAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAxleHBlY3RlZF9zZXEAAAAEAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAEVXaGV0aGVyIGFuIGFzc2V0IGlzIGN1cnJlbnRseSBhZG1pdHRlZCBmb3IgdmFsaWRhdGlvbiBhbmQgc2V0dGxlbWVudC4AAAAAAAAQaXNfYXNzZXRfYWxsb3dlZAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAAB",
        "AAAAAAAAAI9TdG9yZSBhIHVzZXItYXV0aG9yaXplZCBtYW5kYXRlLiBNdXRhYmxlIGZpZWxkcyBhcmUgaW5pdGlhbGl6ZWQgYnkgdGhlCmNvbnRyYWN0IHNvIHRoZSBjYWxsZXIgY2Fubm90IHNlZWQgYSBzcGVudCBiYWxhbmNlLCBzZXF1ZW5jZSwgb3Igc3RhdHVzLgAAAAAQcmVnaXN0ZXJfbWFuZGF0ZQAAAAcAAAAAAAAABHVzZXIAAAATAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAACG1lcmNoYW50AAAAEwAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAptYXhfYW1vdW50AAAAAAALAAAAAAAAAAZleHBpcnkAAAAAAAYAAAAAAAAAB3ZjX2hhc2gAAAAD7gAAACAAAAABAAAD6QAAA+4AAAAgAAAAAw==",
        "AAAAAAAAAIdOb24tdmFsdWUtbW92aW5nIHByZXZpZXcuIEl0IG1heSByZWZyZXNoIFRUTHM7IHRoZSBhdXRob3JpdGF0aXZlIGNoZWNrcwphcmUgcmVwZWF0ZWQgYnkgYGV4ZWN1dGVfcGF5bWVudGAgYWdhaW5zdCBjdXJyZW50IHN0b3JlZCBzdGF0ZS4AAAAAEHZhbGlkYXRlX21hbmRhdGUAAAAFAAAAAAAAAAptYW5kYXRlX2lkAAAAAAPuAAAAIAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAxleHBlY3RlZF9zZXEAAAAEAAAAAAAAAAhtZXJjaGFudAAAABMAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAIpEZXRlcm1pbmlzdGljYWxseSBkZXJpdmUgdGhlIGRvbWFpbi1zZXBhcmF0ZWQgaWRlbnRpZmllciByZXR1cm5lZCBieQpgcmVnaXN0ZXJfbWFuZGF0ZWAgd2l0aG91dCBkZXBlbmRpbmcgb24gYW55IHg0MDIgd2lyZSByZXByZXNlbnRhdGlvbi4AAAAAABFkZXJpdmVfbWFuZGF0ZV9pZAAAAAAAAAcAAAAAAAAABHVzZXIAAAATAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAACG1lcmNoYW50AAAAEwAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAptYXhfYW1vdW50AAAAAAALAAAAAAAAAAZleHBpcnkAAAAAAAYAAAAAAAAAB3ZjX2hhc2gAAAAD7gAAACAAAAABAAAD7gAAACA=",
        "AAAAAAAAAD1DYW5kaWRhdGUgYWRtaW5pc3RyYXRvciB3YWl0aW5nIHRvIGFjY2VwdCBhIHByb3Bvc2VkIGhhbmRvZmYuAAAAAAAAEWdldF9wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAALRDaGFuZ2UgdGhlIHJldmlld2VkLXRva2VuIGFkbWlzc2lvbiBwb2xpY3kuIFBvbGljeSBjaGFuZ2VzIGFyZSBhbGxvd2VkCm9ubHkgd2hpbGUgdGhlIG1vbmV5IHBhdGggaXMgcGF1c2VkOyByZW1vdmFsIGFsc28gYmxvY2tzIGV4aXN0aW5nCm1hbmRhdGVzIGZyb20gZXhlY3V0aW5nIGFnYWluc3QgdGhhdCBhc3NldC4AAAARc2V0X2Fzc2V0X2FsbG93ZWQAAAAAAAACAAAAAAAAAAVhc3NldAAAAAAAABMAAAAAAAAAB2FsbG93ZWQAAAAAAQAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAIZDdXJyZW50IGR1cmFibGUgc3RvcmFnZSBzY2hlbWEuIE1vbmV5LXBhdGggbWV0aG9kcyByZWplY3QgYSBtaXNzaW5nIG9yCnVuZXhwZWN0ZWQgdmVyc2lvbiBzbyBhbiBpbmNvbXBhdGlibGUgdXBncmFkZSBjYW5ub3QgZmFpbCBvcGVuLgAAAAAAEmdldF9zY2hlbWFfdmVyc2lvbgAAAAAAAAAAAAEAAAPpAAAABAAAAAM=",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAEQAAAAAAAAANQWxyZWFkeUV4aXN0cwAAAAAAAAEAAAAAAAAACE5vdEZvdW5kAAAAAgAAAAAAAAAOTWFuZGF0ZUV4cGlyZWQAAAAAAAQAAAAAAAAADk1hbmRhdGVSZXZva2VkAAAAAAAFAAAAAAAAAA5CdWRnZXRFeGNlZWRlZAAAAAAABgAAAAAAAAASTWVyY2hhbnRPdXRPZlNjb3BlAAAAAAAHAAAAAAAAAAtCYWRTZXF1ZW5jZQAAAAAIAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAACQAAAAAAAAAGUGF1c2VkAAAAAAAKAAAAAAAAABRVcGdyYWRlUmVxdWlyZXNQYXVzZQAAAA4AAAAAAAAAD0Fzc2V0Tm90QWxsb3dlZAAAAAAPAAAAAAAAAA5NYW5kYXRlVG9vTG9uZwAAAAAAEAAAAAAAAAARU2VxdWVuY2VFeGhhdXN0ZWQAAAAAAAARAAAAAAAAABhBc3NldFBvbGljeVJlcXVpcmVzUGF1c2UAAAASAAAAAAAAAAxJbnZhbGlkU3RhdGUAAAATAAAAAAAAAA5Ob1BlbmRpbmdBZG1pbgAAAAAAFAAAAAAAAAAPQXNzZXRPdXRPZlNjb3BlAAAAABU=",
        "AAAAAgAAAAAAAAAAAAAABlN0YXR1cwAAAAAAAwAAAAAAAAAAAAAABkFjdGl2ZQAAAAAAAAAAAAAAAAAHUmV2b2tlZAAAAAAAAAAAAAAAAAlFeGhhdXN0ZWQAAAA=",
        "AAAAAQAAAAAAAAAAAAAAB01hbmRhdGUAAAAACgAAADdUaGUgb25seSBwcmluY2lwYWwgcGVybWl0dGVkIHRvIGNhbGwgYGV4ZWN1dGVfcGF5bWVudGAuAAAAAAVhZ2VudAAAAAAAABMAAAAqU0VQLTQxIHRva2VuIGNvbnRyYWN0IHVzZWQgZm9yIHNldHRsZW1lbnQuAAAAAAAFYXNzZXQAAAAAAAATAAAAOkxlZGdlci1jbG9zZSB0aW1lc3RhbXAgYWZ0ZXIgd2hpY2ggdGhlIG1hbmRhdGUgaXMgaW52YWxpZC4AAAAAAAZleHBpcnkAAAAAAAYAAAAnVG90YWwgYW1vdW50IGF1dGhvcml6ZWQgYnkgdGhlIG1hbmRhdGUuAAAAAAptYXhfYW1vdW50AAAAAAALAAAAI1RoZSBvbmx5IGFsbG93ZWQgcGF5bWVudCByZWNpcGllbnQuAAAAAAhtZXJjaGFudAAAABMAAAAvTW9ub3RvbmljIHJlcGxheSBndWFyZCBmb3Igc3VjY2Vzc2Z1bCBwYXltZW50cy4AAAAAA3NlcQAAAAAEAAAAPUFtb3VudCBjb25zdW1lZCBzbyBmYXI7IGFsd2F5cyBiZXR3ZWVuIHplcm8gYW5kIGBtYXhfYW1vdW50YC4AAAAAAAAFc3BlbnQAAAAAAAALAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAGU3RhdHVzAAAAAAA2UHJpbmNpcGFsIGF1dGhvcml6aW5nIHRoZSBtYW5kYXRlIGFuZCB0b2tlbiBhbGxvd2FuY2UuAAAAAAAEdXNlcgAAABMAAACpQ3JlZGVudGlhbCBjb21taXRtZW50IGFuZCBjYWxsZXItc3VwcGxpZWQgdW5pcXVlbmVzcyBzb3VyY2UuIFRoZQpvbi1jaGFpbiBtYW5kYXRlIGlkZW50aWZpZXIgaXMgYSBkb21haW4tc2VwYXJhdGVkIGhhc2ggb3ZlciB0aGlzIHZhbHVlCmFuZCBldmVyeSBpbW11dGFibGUgbWFuZGF0ZSB0ZXJtLgAAAAAAAAd2Y19oYXNoAAAAA+4AAAAg",
        "AAAABQAAAAAAAAAAAAAABlBhdXNlZAAAAAAAAQAAAAZwYXVzZWQAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAEAAAAAAAAABGRhdGEAAAACAAAAAAAAAAA=",
        "AAAABQAAAAAAAAAAAAAACEFkbWluU2V0AAAAAQAAAAVhZG1pbgAAAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAAAAAAAA==",
        "AAAABQAAAAAAAAAAAAAACFVucGF1c2VkAAAAAQAAAAh1bnBhdXNlZAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAEAAAAAAAAABGRhdGEAAAACAAAAAAAAAAA=",
        "AAAABQAAAAAAAAAAAAAACFVwZ3JhZGVkAAAAAQAAAAd1cGdyYWRlAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAEAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAAAA=",
        "AAAABQAAAAAAAAAAAAAADk1hbmRhdGVSZXZva2VkAAAAAAABAAAABnJldm9rZQAAAAAAAQAAAAAAAAAKbWFuZGF0ZV9pZAAAAAAD7gAAACAAAAAAAAAAAA==",
        "AAAABQAAAAAAAAAAAAAAD1BheW1lbnRFeGVjdXRlZAAAAAABAAAAB3BheW1lbnQAAAAABQAAAAAAAAAIbWVyY2hhbnQAAAATAAAAAQAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAQAAAAAAAAAKbWFuZGF0ZV9pZAAAAAAD7gAAACAAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAhzZXF1ZW5jZQAAAAQAAAAAAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAAEU1hbmRhdGVSZWdpc3RlcmVkAAAAAAAAAQAAAAhyZWdpc3RlcgAAAAIAAAAAAAAABHVzZXIAAAATAAAAAQAAAAAAAAAKbWFuZGF0ZV9pZAAAAAAD7gAAACAAAAAAAAAAAA==",
        "AAAABQAAAAAAAAAAAAAAEkFzc2V0UG9saWN5Q2hhbmdlZAAAAAAAAQAAAAxhc3NldF9wb2xpY3kAAAACAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAAAAAAAAdhbGxvd2VkAAAAAAEAAAAAAAAAAA==",
        "AAAABQAAAAAAAAAAAAAAFUFkbWluVHJhbnNmZXJQcm9wb3NlZAAAAAAAAAEAAAANYWRtaW5fcGVuZGluZwAAAAAAAAEAAAAAAAAADXBlbmRpbmdfYWRtaW4AAAAAAAATAAAAAAAAAAA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    pause: this.txFromJSON<null>,
        unpause: this.txFromJSON<null>,
        upgrade: this.txFromJSON<Result<void>>,
        get_admin: this.txFromJSON<string>,
        is_paused: this.txFromJSON<boolean>,
        get_mandate: this.txFromJSON<Result<Mandate>>,
        accept_admin: this.txFromJSON<Result<void>>,
        propose_admin: this.txFromJSON<null>,
        revoke_mandate: this.txFromJSON<Result<void>>,
        execute_payment: this.txFromJSON<Result<void>>,
        is_asset_allowed: this.txFromJSON<boolean>,
        register_mandate: this.txFromJSON<Result<Buffer>>,
        validate_mandate: this.txFromJSON<Result<void>>,
        derive_mandate_id: this.txFromJSON<Buffer>,
        get_pending_admin: this.txFromJSON<Option<string>>,
        set_asset_allowed: this.txFromJSON<Result<void>>,
        get_schema_version: this.txFromJSON<Result<u32>>
  }
}
