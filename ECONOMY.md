# Friend Planets economy

Friend Planets never gives out RF. Players earn **★ Stars** by playing and spend **RF from their own wallet** on premium cosmetics. Every RF purchase is a fixed price for a known item: no loot boxes, no mystery packs, nothing staked on chance.

## Two currencies

| | ★ Stars | RF ($RAREFRIENDS) |
|---|---|---|
| Comes from | Playing: catches, harvests, treasures, quests, sports, ring races, landings, a daily visit bonus, three daily tasks, and selling what you collect at the market | The player's wallet only |
| Buys | Bait, fertilizer, permanent upgrades (rod, hoverboard, seeds), starter hats and rocket paint | Premium hats, auras and rocket paint |
| Real value | None (saved per browser) | Real, settled on-chain by Rare Friends |

Premium items are cosmetic only. Hats and auras are shown to every player on the same planet, so they're for showing off, not for winning.

A **featured shelf** spotlights three premium items each week at 15% off (`FEATURED_OFF`) and rotates every Monday (UTC). Items come back around later; nothing is permanently limited.

The daily visit bonus grows with the player's streak of days in a row (25 ★ on day one, up to 60 ★), and three daily tasks pay 20–40 ★ each plus 50 ★ for all three.

**Bundles** (Royal, Night sky, Party) sell a complete hat + aura + rocket look for 20% off the pieces the player doesn't own yet, so owning one piece never costs extra. A bundle is one order with `item: "bundle:…"` and the discounted price.

## Levels and the Galaxy Pass

- **Explorer level:** every ★ earned is XP. Each level-up pays a ★ bonus and a title (Newcomer → Cosmic Icon); levels 5, 10, 15, 20, 30 and 40 unlock looks that can't be bought (`LEVEL_UNLOCKS` in `progression.ts`). Other players see your level and title online.
- **Galaxy Pass:** a monthly season (UTC calendar month) of 20 tiers, 120 ★ earned per tier. The free track pays Stars, bait and fertilizer. The premium track costs **99 RF once per season** (an order with `item: "pass:YYYY-MM"`) and adds four season-only looks plus 16 more Stars and item rewards; tiers already reached unlock at once. Every reward is listed in the pass screen.

## How players earn RF

Only from other players' purchases, so nobody has to fund payouts and bots have nothing to farm:

- **Planet owners:** an RF purchase made while standing on another Friend's planet sends `OWNER_CUT` (10%) of the price to that Friend's owner. The shop and the checkout say so ("Supports Friend #1234's owner").

Player-to-player trading would be the next earning path; it needs a server-side ledger, so it isn't built yet.

## What needs connecting (Rare Friends team)

All RF goes through one function: `purchase(order)` in [`games/planets3d/src/payments.ts`](games/planets3d/src/payments.ts).

1. Write a `Payments` implementation whose `purchase(order)` asks the player's wallet to pay `order.price` RF and settles `order.split`, then resolves `{ ok: true, tx }` (or `{ ok: false, why }` to show the player).
2. Call `setPayments(yourImplementation)` before the game starts. Set `simulated: false` so the UI drops its preview notes.

The game hands the item over only after `purchase` resolves with `ok`. Until then `SimulatedPayments` approves every order after a short delay and moves no RF.

### The order

```ts
interface Order {
  id: string;                 // unique per purchase
  item: string;               // e.g. "hat:crown" or "bundle:royal" (catalogue in economy.ts)
  price: number;              // RF, whole tokens
  buyer: string;              // buyer's Friend token number
  planetOwner: number | null; // Friend whose planet it was bought on, or null at home
  split: { builder: number; rareFriends: number; planetOwner: number }; // RF, sums to price
  at: number;                 // ms since epoch
  tx?: string;                // filled in from purchase()
}
```

The split is set in [`economy.ts`](games/planets3d/src/economy.ts): `RF_SPLIT` (75% builder / 25% Rare Friends) and `OWNER_CUT` (10%, taken from the builder's share). **To confirm with Rare Friends:** whether the owner cut should come from the builder's share, from Rare Friends' share, or from both.

## Before real RF goes live

- **Ownership must be server-side.** Owned items and Stars are saved in the browser, which players can edit. That's harmless for Stars, but owned *premium* items should be checked against the purchase records (orders / transactions) on a server or on-chain, not trusted from the browser.
- **Planet-owner payouts** need the owner of each Friend token at purchase time; resolve it from `order.planetOwner` on your side.

## Prices

Every price, sell value and reward lives in [`economy.ts`](games/planets3d/src/economy.ts) (`SHOP`, `SELL_BY_RARITY`, `DAILY_STARS`). Premium prices today range from 25 RF (Scholar hat) to 150 RF (Crown).
