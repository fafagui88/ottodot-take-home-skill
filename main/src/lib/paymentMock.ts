import { randomUUID } from "node:crypto";

/**
 * Stand-in for a payment provider. The caller picks the outcome so the demo and
 * tests can drive success / failure deterministically. delayMs simulates the
 * time a parent spends on the payment page (useful for race demos).
 */
export type ChargeOutcome = "success" | "fail";

export type ChargeResult =
  | { ok: true; providerRef: string }
  | { ok: false; providerRef: string; reason: string };

export async function charge(opts: {
  amountCents: number;
  outcome: ChargeOutcome;
  delayMs?: number;
}): Promise<ChargeResult> {
  if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
  const providerRef = `mock_ch_${randomUUID().slice(0, 12)}`;
  if (opts.outcome === "fail") return { ok: false, providerRef, reason: "card_declined" };
  return { ok: true, providerRef };
}

export async function refund(providerRef: string): Promise<{ ok: true; refundRef: string }> {
  return { ok: true, refundRef: `mock_re_${providerRef.slice(8)}` };
}
