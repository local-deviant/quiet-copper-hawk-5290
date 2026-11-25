# Strategy: crowd-surge scalp (rebuild 26 Nov 2026)

## The edge

On the dev window (24h, 1,222 curves, 126,801 trades) an unconditional early
buy loses money at every age and hold tested (best cell: buy at create, hold
10 slots, mean net -1.15% per trade after fees). The edge is not being early —
it is selection plus regime. Three filters, each measured separately, lift the
win rate from ~13% to ~57%:

1. **Crowd validation.** Buy only once at least 6 distinct non-creator wallets
   have bought the curve while it is still young (age <= 10 slots). Win rate
   41% at 7 buyers / 45% at 6 buyers, vs 13% unfiltered. (A cap on buyer
   count — the house pilot's maxBuyers=3, meant to dodge bundled launches —
   tested strictly worse: hot launches with many buyers are the good ones.)
2. **Real reserves.** The 1%-of-real-reserve buy cap means entries on tiny
   curves are tiny and their fills are the worst; win rate climbs with real
   reserves at entry (26% at >= 3 SOL, 46% at >= 10 SOL). The stake is set at
   0.4 SOL so the big, liquid launches get real size.
3. **Market heat.** Launches per hour split the dev window cleanly: 28–45/h
   in the cold half (03:00–13:00 UTC) vs 50–87/h in the hot half (13:00–03:00
   UTC). The unfiltered strategy loses ~-0.25 SOL in the cold half and makes
   ~+1.15 SOL in the hot half. So the bot only enters while at least 50 curves
   were created in the last hour. In the cold half it then trades ~5 coins and
   ends flat (+0.0003 SOL) instead of bleeding; in the hot half it trades 117.

## Entry (one per curve, never re-entered)

- Age <= 10 slots since CreateEvent, >= 6 distinct non-creator buyers,
  creator's create-slot buy <= 2.5 SOL, creator has not sold, real reserves
  >= 0.3 SOL, price at or above its create price, net inflow over the last
  5 slots >= 0, and market heat >= 50 creates/hour.
- Fixed stake 0.4 SOL per scalp (capped at 1% of real reserves, and skipped
  below the 0.01 SOL minimum round trip), at most 5 open positions.
- Buys use 1,000 bps slippage and a rejected buy does NOT burn the coin: the
  entry is retried on later batches while it still qualifies. (Rejected orders
  cost nothing, so tight buy slippage is a free option against the 2-slot
  fill latency.)

## Exits (every open position is re-priced every batch)

- Take profit +8% of cost, stop loss -50% of cost (wide on purpose: noise
  must not shake the bot out of runners), 300-slot time stop, exit at once
  when the creator sells.
- Sells use 10,000 bps slippage so an exit always lands. Tight sell slippage
  tested worse (-0.03 vs +0.09 SOL): crashes continue, and the retry only
  sells lower.
- A sale's value is the constant-product quote out for the tokens held
  (minus the 1.25% curve fee and the tx fee), not a mark-price
  multiplication, so exits are judged on what a sale would actually return.

## Dev results (faithful offline replay = the kit's own sim port, all 3 dataset parts)

Final config: net **+1.734 SOL**, hourly Sharpe proxy **+0.415**, 129 round
trips on 129 distinct mints, **56.6% win**, max drawdown **4.3%** (guardrail:
50%). Both window halves non-negative: first half +0.0003 SOL (6 trips, heat
filter mostly idle), second half +1.551 SOL (117 trips). Top 3 coins
contribute +0.637 SOL of the net — the strategy is a many-small-losses /
few-big-runners shape, which the stress test below quantifies.

## What the 25 Nov build taught us (kept as history)

The first build (first-crossing sniper scalp: buy at 1 SOL real reserves,
TP +20% / SL -10%, 600-slot hold) graded **-1.019 SOL, 23% win** on the real
harness. A faithful replay reproduced the grade (-0.92 SOL): orders fill
2 slots later against the last trade in the fill slot, and the median buy
fill landed 15.5% above the decision price (mean +54.7%) — the decision-price
edge was consumed entirely by the fill. Every other family tested then also
lost on this window: dip-buying (-0.63 to -0.82), mature momentum (-0.52 to
-1.03), slow momentum (-0.17 to -0.54, only 46 trades), calm accumulation
(-0.34 to -0.41), tail-capture (-0.50 to -0.76); even the house pilot momentum
graded -9.38 SOL. The rebuild keeps none of that entry logic: it buys later
(crowd-validated, not first-crossing), smaller and more selectively, exits at
+8% instead of +20%, and refuses to trade cold hours at all.

## Variants tried and rejected (faithful replay, full 24h dev window)

- House pilot momentum defaults: -9.38 SOL, 95% drawdown. Reversion
  defaults: -1.78 SOL. Sniper defaults: -0.49 SOL.
- Tight buy slippage 100 bps at the old entry: -0.17 SOL (rejects the good
  pumps too). At the new entry, 1,000 bps beats 100/300/10,000 bps.
- Tight sell slippage 300 bps: -0.03 SOL vs +0.09 at 10,000 bps — rejected.
- Take profit +30%/+100%: -1.02 / -2.16 SOL, drawdown 14–25% — winners must
  be banked at +8%; the 2-slot fill overshoot is what makes them big, and a
  high TP lets positions round-trip back down.
- Trailing stops (arm +5–10%, giveback 3–10%) and partial take-profits
  (sell half at +5–8%): all slightly worse than the plain +8% TP.
- Pyramiding adds into strength: worse (-0.01 to +0.07 vs +0.09 base).
- Max run-up caps (buy only if price < +20–100% over create): worse — the
  run-up IS the signal; capping it removes the winners.
- minBuyers 4–5: worse than 6 (more coins, lower quality). minBuyers 8+:
  worse (too few coins). Stake 0.05–0.1 SOL: worse than 0.4 SOL (the big
  liquid launches deserve size; the 1% cap binds most buys anyway).
- Heat 35–45: net +0.84–1.48 SOL, Sharpe +0.21–0.35 — worse than heat 50
  (+1.73, +0.415), and heat 45 still loses -0.10 SOL in the cold half.
  Heat 55–60: fewer trips, less net (+0.80–1.08). Heat 50 is the peak of a
  flat region (45–50), not a tuned spike; stake 0.4 vs 0.6 SOL is identical
  (+1.734 vs +1.743).
- No time stop (hold until TP/SL only): +0.47 SOL, 107 trips — the 5-position
  cap binds and entries stall. Max hold 60/120 slots: +0.61/+0.74 SOL —
  worse than 300 slots; runners need room.

## Risks, stated plainly

- The dev profit is concentrated: the top 3 coins earn +0.64 SOL of the
  +1.73 SOL net, and the hot half earns nearly all of it. The final window is
  6 fresh hours (28 Nov 17:00–23:00 UTC) — its clock hours match the dev
  window's hottest hours (17:00–23:00 UTC ran 50–87 launches/hour), which is
  why heat 50 is trusted, but a cold final window would leave this entry near
  flat (the heat filter idles) rather than profitable.
- In a 6h window the bot is expected to make ~55–60 round trips (129 in 24h
  dev, 117 of them in the hot half), comfortably above the 20-mint guardrail
  in a hot window; in a cold window it would fall short of 20 mints and rank
  below guardrail-meeting entries — accepted, because in a cold window no
  tested variant is profitable anyway.
