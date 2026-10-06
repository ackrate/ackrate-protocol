// Immutable historical protocol identifiers. They identify signed bytes and
// the separate authorization extension; they do not select a live deployment.
export const HISTORICAL_BINDING_VERSION = "reapp-ap2/2" as const;
export const HISTORICAL_CREDENTIAL_VERSION = "reapp-ap2-credential/2" as const;
export const HISTORICAL_SIGNATURE_DOMAIN = "REAPP\u0000AP2\u0000SIGNED-MANDATE\u0000V2\u0000" as const;
export const HISTORICAL_CAPTURE_DOMAIN = "REAPP\u0000AP2\u0000CAPTURE\u0000V1\u0000" as const;
export const HISTORICAL_PARTICIPATION_DOMAIN = "REAPP\u0000AP2\u0000POOL-PARTICIPATION\u0000V1\u0000" as const;
export const HISTORICAL_SCHEDULE_DOMAIN = "REAPP\u0000AP2\u0000SCHEDULE\u0000V1\u0000" as const;
export const HISTORICAL_OPEN_POOL_VCT = "https://reapp.live/ap2/mandate/pool-participation.open/1" as const;
export const HISTORICAL_CLOSED_POOL_VCT = "https://reapp.live/ap2/mandate/pool-participation/1" as const;
