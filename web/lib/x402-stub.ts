/**
 * Stub for the optional @x402/* payment packages that @coinbase/cdp-sdk imports (reached through
 * RainbowKit -> wagmi connectors -> @base-org/account during server rendering). Dripp never uses
 * x402 payments; every export throws if it is ever called.
 */
const unavailable = (name: string) =>
  function stub(): never {
    throw new Error(`${name}: x402 payments are not available in Dripp`);
  };

export const x402Client = unavailable("x402Client");
export const x402ResourceServer = unavailable("x402ResourceServer");
export const x402HTTPResourceServer = unavailable("x402HTTPResourceServer");
export const HTTPFacilitatorClient = unavailable("HTTPFacilitatorClient");
export const toClientEvmSigner = unavailable("toClientEvmSigner");
export const registerExactEvmScheme = unavailable("registerExactEvmScheme");
export const registerExactSvmScheme = unavailable("registerExactSvmScheme");
export const ExactEvmScheme = unavailable("ExactEvmScheme");
export const ExactEvmSchemeV1 = unavailable("ExactEvmSchemeV1");
export const UptoEvmScheme = unavailable("UptoEvmScheme");
export const ExactSvmScheme = unavailable("ExactSvmScheme");
export const ExactSvmSchemeV1 = unavailable("ExactSvmSchemeV1");
export const UptoSvmScheme = unavailable("UptoSvmScheme");
export const AuthCaptureEvmScheme = unavailable("AuthCaptureEvmScheme");
export const BatchSettlementEvmScheme = unavailable("BatchSettlementEvmScheme");
export const wrapFetchWithPayment = unavailable("wrapFetchWithPayment");
export default {};
