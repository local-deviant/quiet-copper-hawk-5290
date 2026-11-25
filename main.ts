// Pump.fun Sharpe Sprint — crowd-surge scalp.
//
// Idea, in one paragraph: most new pump.fun curves die within minutes, and the
// ones that pay are the launches a real crowd piles into while the market is
// hot. So this bot only buys a curve once at least six distinct non-creator
// wallets have bought it while it is still young (age <= 10 slots), with fresh
// net inflow over the last 5 slots and the price already up over its create
// price — and only while the market itself is hot (at least 50 curves created
// in the last hour). The creator's own create-slot buy must stay small and a
// coin whose creator already sold is skipped outright. Size is fixed and small
// (0.4 SOL, capped at 1% of real reserves), at most 5 open positions, one
// entry per coin, never re-entered. Exits are fast and asymmetric: take profit
// at +8% (small, frequent wins are what the hourly Sharpe ranking rewards),
// a wide stop at -50% so noise does not shake the bot out of runners, and a
// 300-slot time stop. Buys use tight slippage (1,000 bps) and a rejected buy
// does not burn the coin — the entry is retried while it still qualifies.
// Sells use loose slippage so an exit always lands: in testing, tight sell
// slippage did worse, because crashes continue and the retry only sells lower.
//
// Deterministic by construction: no clock, no environment reads, no
// randomness; every decision is a pure function of the batch stream, so the
// two grading executions agree byte for byte. See STRATEGY.md for the design,
// the dev-window numbers, and the variants that were tried and rejected.

import { runBot } from './vendor/makefun-bot.ts';
import { BPS } from './vendor/makefun-bot.ts';
import type { Batch, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

// --- tunables (chosen on the dev window; see STRATEGY.md) -----------------
const MIN_BUYERS = 6; // distinct non-creator buyers before entry
const MAX_AGE_SLOTS = 10; // oldest age (slots since create) at first buy
const MIN_REAL_SOL = 0.3; // SOL of real reserves at decision time
const MAX_DEV_BUY_SOL = 2.5; // creator's create-slot buy must stay below this
const MIN_FLOW_SOL = 0; // net SOL inflow over the flow window (0 = any inflow)
const FLOW_WINDOW_SLOTS = 5; // recent-flow window, in slots
const MIN_RUNUP_BPS = 10_000; // price now >= create price (10,000 bps = flat)
const STAKE_SOL = 0.4; // SOL per scalp (capped at 1% of real reserves)
const MIN_BUY_LAMPORTS = 10_000_000n; // 0.01 SOL: the guardrail's minimum round trip
const BUY_SLIPPAGE_BPS = 1000; // fills 2 slots later; refuse a fast pump that ran
const SELL_SLIPPAGE_BPS = 10_000; // exits must land: never let slippage strand a position
const TAKE_PROFIT_BPS = 800; // sell when the position is worth cost * 1.08
const STOP_LOSS_BPS = 5000; // sell when the position is worth cost * 0.50
const MAX_HOLD_SLOTS = 300; // time stop, in slots since the buy filled
const TRAIL_ARM_BPS = 1_000_000; // trailing exit disabled (arms at +10,000%)
const TRAIL_BPS = 1000;
const EXIT_ON_DEV_SELL = true; // leave at once when the creator sells
const SKIP_DEV_SOLD = true; // never buy a coin whose creator already sold
const MIN_HEAT = 50; // only enter while >= 50 curves were created in the last hour
const CURVE_FEE_BPS = 125n; // protocol + creator fee share taken on each side

const LAMPORTS = 1_000_000_000;

/** What selling `tokens` against (vq, vt) would pay after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * CURVE_FEE_BPS + BPS - 1n) / BPS;
}

interface Tick {
  slot: number;
  isBuy: boolean;
  sol: bigint;
  user: Pubkey;
}

interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Create-time reserves: the price run-up is measured against them. */
  vq0: bigint;
  vt0: bigint;
  /** Creator's own buys in the create slot. */
  devBuy: bigint;
  /** The creator sold at least once. */
  devSold: boolean;
  /** Distinct non-creator buyers seen. */
  buyers: Set<Pubkey>;
  /** Trades of the last flow window (older ones dropped as new ones come). */
  recent: Tick[];
  /** Never buy it again (exited, filtered out for good, or completed). */
  done: boolean;
  complete: boolean;
}

interface Held {
  /** Slot the buy filled. */
  openedSlot: number;
  /** Tx fees paid on this position's orders so far. */
  txPaid: bigint;
  /** Best sale value seen so far (for the trailing stop). */
  best: bigint;
}

// --- per-run state (closure, not globals: one run per process) ------------
const coins = new Map<Pubkey, Coin>();
const held = new Map<Pubkey, Held>();
/** Mints with a sell in flight. */
const selling = new Set<Pubkey>();
/** Mints with a buy in flight. */
const buying = new Set<Pubkey>();
/** Block times (seconds) of CreateEvents, for the market-heat filter. */
const creates: number[] = [];
let nowTime = 0;

/** Net lamports bought minus sold over the last FLOW_WINDOW_SLOTS slots. */
function flow(c: Coin, slot: number): bigint {
  const from = slot - FLOW_WINDOW_SLOTS;
  let drop = 0;
  while (drop < c.recent.length && c.recent[drop]!.slot <= from) drop++;
  if (drop > 0) c.recent.splice(0, drop);
  let net = 0n;
  for (const t of c.recent) net += t.isBuy ? t.sol : -t.sol;
  return net;
}

function readEvents(batch: Batch): void {
  for (const e of batch.events) {
    if (e.event === 'CreateEvent') {
      if (e.block_time !== null) {
        creates.push(e.block_time);
        if (e.block_time > nowTime) nowTime = e.block_time;
      }
      coins.set(e.mint, {
        mint: e.mint,
        createSlot: e.slot,
        creator: e.creator,
        vq0: BigInt(e.virtual_quote_reserves),
        vt0: BigInt(e.virtual_token_reserves),
        devBuy: 0n,
        devSold: false,
        buyers: new Set(),
        recent: [],
        done: false,
        complete: false,
      });
    } else if (e.event === 'TradeEvent') {
      const c = coins.get(e.mint);
      if (c === undefined) continue;
      const sol = BigInt(e.sol_amount);
      c.recent.push({ slot: e.slot, isBuy: e.is_buy, sol, user: e.user });
      const isDev = e.user === c.creator;
      if (e.is_buy) {
        if (isDev && e.slot === c.createSlot) c.devBuy += sol;
        else if (!isDev) c.buyers.add(e.user);
      } else if (isDev) {
        c.devSold = true;
      }
    } else {
      const c = coins.get(e.mint);
      if (c !== undefined) {
        c.complete = true;
        c.done = true;
      }
    }
  }
}

await runBot({
  onBatch(state: BotState, batch: Batch): OrderInput[] {
    readEvents(batch);
    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = state.txFeeLamports();
    const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
    for (const m of batch.marks) marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });

    // Fold fills: track held positions, clear in-flight flags. A rejected buy
    // does not burn the coin (buying is cleared, so it can be retried); a
    // rejected sell is retried on the next batch the same way.
    for (const f of batch.fills) {
      if (f.client_id.startsWith('_')) {
        held.delete(f.mint);
        selling.delete(f.mint);
        buying.delete(f.mint);
        continue;
      }
      const h = held.get(f.mint);
      if (f.status !== 'rejected' && h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
      if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
        held.set(f.mint, { openedSlot: f.slot, txPaid: BigInt(f.tx_fee_lamports), best: 0n });
        buying.delete(f.mint);
      }
      if (f.side === 'buy' && f.status === 'rejected') buying.delete(f.mint);
      if (f.side === 'sell') selling.delete(f.mint);
    }
    for (const mint of [...selling]) {
      let pending = false;
      for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'sell') pending = true;
      if (!pending) selling.delete(mint);
    }
    for (const mint of [...held.keys()]) {
      if (!state.positions.has(mint) && !selling.has(mint)) {
        let pendingBuy = false;
        for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'buy') pendingBuy = true;
        if (!pendingBuy) held.delete(mint);
      }
    }

    // --- exits first: every open position is re-priced every batch -------
    for (const [mint, pos] of state.positions) {
      if (orders.length >= cap) break;
      if (selling.has(mint)) continue;
      const c = coins.get(mint);
      let h = held.get(mint);
      if (h === undefined) {
        h = { openedSlot: state.slot, txPaid: tx, best: 0n };
        held.set(mint, h);
      }
      let mk = marks.get(mint);
      if (mk === undefined) {
        const cv = state.curves.get(mint);
        if (cv === undefined) continue;
        mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
      }
      const value = sellValue(pos.token_amount, mk.vq, mk.vt) - tx;
      const basis = pos.cost_lamports + h.txPaid;
      if (value > h.best) h.best = value;
      let exit = false;
      if (basis > 0n) {
        if (value * BPS >= basis * (BPS + BigInt(TAKE_PROFIT_BPS))) exit = true;
        if (value * BPS <= basis * (BPS - BigInt(STOP_LOSS_BPS))) exit = true;
        if (h.best * BPS >= basis * (BPS + BigInt(TRAIL_ARM_BPS)) && value * BPS <= h.best * (BPS - BigInt(TRAIL_BPS))) exit = true;
      }
      if (state.slot - h.openedSlot >= MAX_HOLD_SLOTS) exit = true;
      if (c !== undefined && EXIT_ON_DEV_SELL && c.devSold) exit = true;
      if (!exit) continue;
      orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: SELL_SLIPPAGE_BPS });
      selling.add(mint);
      if (c !== undefined) c.done = true;
    }

    // --- entries: crowd-validated young launches, only while the market is hot ---
    let free = state.freeCashLamports() - tx * BigInt(orders.length);
    let open = state.committedPositionCount();
    let heat = 0;
    if (MIN_HEAT > 0) {
      while (creates.length > 0 && creates[0]! < nowTime - 3600) creates.shift();
      heat = creates.length;
    }
    const heatOk = MIN_HEAT <= 0 || heat >= MIN_HEAT;
    const stake = BigInt(Math.floor(STAKE_SOL * LAMPORTS));
    for (const c of coins.values()) {
      if (orders.length >= cap) break;
      if (c.done || c.complete) continue;
      const age = state.slot - c.createSlot;
      if (age > MAX_AGE_SLOTS) {
        c.done = true;
        continue;
      }
      if (open >= state.hello.caps.max_open_positions) continue;
      if (!heatOk) continue;
      const curve = state.curves.get(c.mint);
      if (curve === undefined || curve.complete) continue;
      if (c.devSold && SKIP_DEV_SOLD) {
        c.done = true;
        continue;
      }
      if (c.buyers.size < MIN_BUYERS) continue;
      if (c.devBuy > BigInt(Math.floor(MAX_DEV_BUY_SOL * LAMPORTS))) {
        c.done = true;
        continue;
      }
      const rq = curve.real_quote_reserves;
      if (rq < BigInt(Math.floor(MIN_REAL_SOL * LAMPORTS))) continue;
      const vq = curve.virtual_quote_reserves;
      const vt = curve.virtual_token_reserves;
      const runup = (vq * c.vt0 * BPS) / (vt * c.vq0);
      if (runup < BigInt(MIN_RUNUP_BPS)) continue;
      if (flow(c, state.slot) < BigInt(Math.floor(MIN_FLOW_SOL * LAMPORTS))) continue;
      if (buying.has(c.mint)) continue;
      const maxBuy = state.maxBuyLamports(c.mint);
      const amount = stake < maxBuy ? stake : maxBuy;
      if (amount < MIN_BUY_LAMPORTS) continue;
      if (free < amount + tx) continue;
      orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: BUY_SLIPPAGE_BPS });
      buying.add(c.mint);
      free -= amount + tx;
      open += 1;
    }

    return orders;
  },
});
