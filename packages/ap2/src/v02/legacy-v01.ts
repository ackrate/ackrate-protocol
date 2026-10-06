// The compatibility entry points delegate to the unchanged current v0.1 API.
export {
  AP2_SPEC_VERSION as AP2_V01_SPEC_VERSION,
  AP2_INTENT_DATA_KEY as AP2_V01_INTENT_DATA_KEY,
  ACKRATE_AP2_BINDING_VERSION as ACKRATE_AP2_V01_BINDING_VERSION,
  normalizeAp2Intent as normalizeAp2V01Intent,
  bindIntentMandate,
  signAp2Mandate as signAp2V01Mandate,
  type NormalizedAp2IntentMandate as NormalizedAp2V01IntentMandate,
  type Ap2IntentMandate as Ap2V01IntentMandate,
  type StellarMandateAuthorization as StellarV01MandateAuthorization,
  type BindIntentMandateInput,
  type Ap2MandateBinding as Ap2V01MandateBinding,
} from "../index.js";
export {
  ACKRATE_AP2_CREDENTIAL_VERSION as ACKRATE_AP2_V01_CREDENTIAL_VERSION,
  ACKRATE_AP2_SIGNATURE_ALGORITHM as ACKRATE_AP2_V01_SIGNATURE_ALGORITHM,
  ap2CredentialSigningDigest as ap2V01CredentialSigningDigest,
  parseSignedAp2Mandate as parseSignedAp2V01Mandate,
  decodeCanonicalSignature as decodeCanonicalV01Signature,
  rebuildCredentialBinding as rebuildV01CredentialBinding,
  type AckrateAp2CredentialPayload as AckrateAp2V01CredentialPayload,
  type SignedAp2Mandate as SignedAp2V01Mandate,
} from "../credential.js";
