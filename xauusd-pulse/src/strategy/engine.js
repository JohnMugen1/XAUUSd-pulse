const defaultStrategy = require('./rsiEma');

// Find where a trade ends. If one bar touches both stop and target, the stop is assumed to hit first
// (the pessimistic choice). Returns null when the data ends before the trade is resolved.
function findExit(candles, from, dir, sl, tp, maxHold) {
  const lastIdx = from + maxHold - 1;
  const end = Math.min(candles.length - 1, lastIdx);
  for (let j = from; j <= end; j++) {
    const c = candles[j];
    if (dir === 'buy') {
      if (c.low <= sl) return { j, price: sl, reason: 'sl' };
      if (c.high >= tp) return { j, price: tp, reason: 'tp' };
    } else {
      if (c.high >= sl) return { j, price: sl, reason: 'sl' };
      if (c.low <= tp) return { j, price: tp, reason: 'tp' };
    }
  }
  if (lastIdx > candles.length - 1) return null;
  return { j: lastIdx, price: candles[lastIdx].close, reason: 'time' };
}

// Bar-by-bar simulation on CLOSED candles: signal at a bar's close, entry at the NEXT bar's open
// (no look-ahead), one position at a time.
function simulate(candles, overrides, strat = defaultStrategy) {
  const { params, ind, signals } = strat.compute(candles, overrides);
  const trades = [];
  let i = 0;
  while (i < candles.length - 1) {
    const s = signals[i];
    if (s.dir === 'hold') { i++; continue; }
    const k = i + 1;
    const entry = candles[k].open;
    const risk = s.risk;
    const sl = s.dir === 'buy' ? entry - risk : entry + risk;
    const tp = s.dir === 'buy' ? entry + params.rr * risk : entry - params.rr * risk;
    const ex = findExit(candles, k, s.dir, sl, tp, params.maxHoldBars);
    if (!ex) break; // trade still open at the end of the data: not counted
    const gross = s.dir === 'buy' ? ex.price - entry : entry - ex.price;
    trades.push({
      direction: s.dir,
      entry_ts: candles[k].ts,
      exit_ts: candles[ex.j].ts,
      entry, exit: ex.price,
      pnl: gross - params.costPerTrade,
      risk, // stop distance in points, so every trade can also be measured in R (1R = the amount risked)
      r: (gross - params.costPerTrade) / risk,
      reason: ex.reason,
    });
    i = ex.j;
  }
  const signalCount = signals.filter((x) => x.dir !== 'hold').length;
  return { params, trades, signalCount, metrics: metrics(trades) };
}

function metrics(trades) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  let equity = 0, peak = 0, maxDD = 0;
  for (const t of trades) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  const rs = trades.map((t) => t.r).filter(Number.isFinite);
  const netR = rs.reduce((x, y) => x + y, 0);
  const posR = rs.filter((x) => x > 0).reduce((x, y) => x + y, 0);
  const negR = -rs.filter((x) => x <= 0).reduce((x, y) => x + y, 0);
  let eqR = 0, peakR = 0, ddR = 0, streak = 0, maxStreak = 0;
  for (const t of trades) {
    if (Number.isFinite(t.r)) { eqR += t.r; peakR = Math.max(peakR, eqR); ddR = Math.max(ddR, peakR - eqR); }
    if (t.pnl <= 0) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
  }
  return {
    netR, avgR: rs.length ? netR / rs.length : 0,
    profitFactorR: negR > 0 ? posR / negR : null,
    maxDrawdownR: ddR, maxLossStreak: maxStreak,
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null, // null = no losing trades
    netProfit: equity,
    maxDrawdown: maxDD,
    peak,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
  };
}


module.exports = { findExit, simulate, metrics };
