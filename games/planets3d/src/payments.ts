/**
 * Where RF purchases leave the game. The game builds an Order (economy.ts) and
 * calls `payments.purchase(order)`; the item is handed over only once that
 * resolves with ok. This is the one place the Rare Friends team connects to the
 * chain: replace SimulatedPayments with an implementation that asks the player's
 * wallet to pay `order.price` RF and settles `order.split` (builder, Rare Friends,
 * and the planet owner's cut), then call `setPayments(real)` at start-up.
 *
 * Until then everything here is simulated: no wallet prompt, no RF moves, and
 * orders are kept in the player's save so the flow and the split can be tested.
 */
import type { Order } from "./economy";

export type PurchaseResult = { ok: true; tx: string } | { ok: false; why: string };
export interface Payments {
  /** True while purchases don't move real RF (the UI says so). */
  readonly simulated: boolean;
  /** Ask the player's wallet to pay for this order. */
  purchase(order: Order): Promise<PurchaseResult>;
}

class SimulatedPayments implements Payments {
  readonly simulated = true;
  async purchase(order: Order): Promise<PurchaseResult> {
    await new Promise(res => window.setTimeout(res, 700)); // feels like a wallet confirming
    return { ok: true, tx: `sim-${order.id}` };
  }
}

export let payments: Payments = new SimulatedPayments();
export function setPayments(p: Payments) { payments = p; }
