import { Buffer } from "buffer";

/** A registry return is an opaque 32-byte storage key, not the credential hash. */
export function registeredMandateId(value: unknown): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
    throw new Error("MandateRegistry returned an invalid mandate identifier");
  }
  return Buffer.from(value);
}

export function applyRegisteredMandateId(
  mandate: { id: string; idBuffer: Buffer; credentialHash?: string },
  preparedId: Buffer,
  submittedId: unknown,
): void {
  const registeredId = registeredMandateId(submittedId);
  if (!registeredId.equals(preparedId)) {
    throw new Error("MandateRegistry returned different identifiers before and after submission");
  }
  mandate.credentialHash ??= mandate.id;
  mandate.idBuffer = registeredId;
  mandate.id = registeredId.toString("hex");
}
