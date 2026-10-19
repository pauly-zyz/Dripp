import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { app } from "../db.ts";
import { HttpError } from "../util.ts";
import type { Deps } from "./context.ts";

/** Message the referee signs (EIP-191) to register who referred them. One referrer per wallet, forever. */
export const referralMessage = (referrer: Address, referee: Address) =>
  `Dripp referral\nReferrer: ${referrer}\nReferee: ${referee}`;

export async function registerReferral(deps: Deps, referee: Address, referrer: Address, signature: Hex) {
  if (referee === referrer) throw new HttpError(400, "cannot refer yourself");
  const ok = await deps.chain.client.verifyMessage({
    address: referee,
    message: referralMessage(referrer, referee),
    signature,
  });
  if (!ok) throw new HttpError(401, "invalid signature");
  const { referrals } = app;
  const [existing] = await deps.db.select().from(referrals).where(eq(referrals.referee, referee));
  if (existing) throw new HttpError(409, "referrer already set");
  const [loop] = await deps.db.select().from(referrals).where(eq(referrals.referee, referrer));
  if (loop?.referrer === referee) throw new HttpError(400, "circular referral");
  await deps.db.insert(referrals).values({ referee, referrer, signature });
  return { referee, referrer };
}

export async function getReferralRows(deps: Deps) {
  return deps.db.select().from(app.referrals);
}
