import { getAddress, isAddress, type Address } from "viem";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Lowercase address or a 400. */
export function parseAddress(value: string | undefined, name = "address"): Address {
  if (!value || !isAddress(value, { strict: false })) throw new HttpError(400, `invalid ${name}`);
  return getAddress(value).toLowerCase() as Address;
}

/** bigint -> string for JSON responses. */
export const str = (x: bigint | null | undefined) => (x === null || x === undefined ? null : x.toString());

export const wadToNumber = (x: bigint) => Number(x) / 1e18;

export const isoDate = (unixSeconds: number | bigint) => new Date(Number(unixSeconds) * 1000).toISOString();
