/**
 * Compatibility declarations copied without API changes from
 * @stellar/stellar-sdk 16.3.0/types/stellar__js-xdr/index.d.ts.
 * Copyright Stellar Development Foundation. SPDX-License-Identifier: Apache-2.0
 * https://github.com/stellar/js-stellar-sdk
 *
 * Upstream ships these declarations but omits them from its public type graph.
 * Keep this reference until the upstream public entrypoint includes them.
 * ACKRATE changes: reformatted whitespace and added this provenance header.
 */
declare module "@stellar/js-xdr" {
  export abstract class LargeInt {
    constructor(values: Array<bigint | number | string> | bigint | number | string);
    static defineIntBoundaries(): void;
    static MIN_VALUE: LargeInt;
    static MAX_VALUE: LargeInt;
    static isValid(value: unknown): boolean;
    static fromString(value: string): LargeInt;
    abstract get unsigned(): boolean;
    abstract get size(): number;
    toBigInt(): bigint;
    toString(): string;
    slice(chunkSize: number): bigint[];
  }
  export class Hyper extends LargeInt {
    get unsigned(): boolean;
    get size(): number;
    constructor(values: Array<bigint | number | string> | bigint | number | string);
    static defineIntBoundaries(): void;
    static MIN_VALUE: Hyper;
    static MAX_VALUE: Hyper;
    static isValid(value: unknown): boolean;
    static fromString(value: string): Hyper;
  }
  export class UnsignedHyper extends LargeInt {
    get unsigned(): boolean;
    get size(): number;
    constructor(values: Array<bigint | number | string> | bigint | number | string);
    static defineIntBoundaries(): void;
    static MIN_VALUE: UnsignedHyper;
    static MAX_VALUE: UnsignedHyper;
    static isValid(value: unknown): boolean;
    static fromString(value: string): UnsignedHyper;
  }
  export class XdrWriter {
    constructor(buffer?: Buffer | number);
    alloc(size: number): number;
    resize(minRequiredSize: number): void;
    finalize(): Buffer;
    write(value: string | Buffer, size?: number): void;
    result(): Buffer;
  }
  export class XdrReader {
    constructor(buffer: Buffer);
    get eof(): boolean;
    advance(size: number): void;
    rewind(): void;
    read(size: number): Buffer;
  }
}
