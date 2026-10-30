// Oversold/overbought bounce (mean reversion): bet that a stretched price snaps back toward its average.
//   BUY : RSI turns back up through rsiLow while price is still below its average
//   SELL: RSI turns back down through rsiHigh while price is still above its average
const { rsi, sma, atr } = require('../lib/indicators');

const DEFAULTS = { rsiPeriod: 14, rsiLow: 30, rsiHigh: 70, smaPeriod: 20, atrPeriod: 14, atrMult: 1.5, rr: 1.5, maxHoldBars: 24, costPerTrade: 0.35 };

function compute(candles, overrides = {}) {
  const params = { ...DEFAULTS, ...overrides };
  if (overrides.rsiLow != null && overrides.rsiHigh == null) params.rsiHigh = 100 - overrides.rsiLow;
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const r = rsi(close, params.rsiPeriod);
  const m = sma(close, params.smaPeriod);
  const a = atr(high, low, close, params.atrPeriod);

  const signals = candles.map((c, i) => {
    const s = { dir: 'hold', entry: c.close, sl: null, tp: null, risk: null };
    if (i < 1 || r[i] == null || r[i - 1] == null || m[i] == null || a[i] == null) return s;
    const risk = params.atrMult * a[i];
    if (r[i - 1] < params.rsiLow && r[i] >= params.rsiLow && c.close < m[i]) {
      Object.assign(s, { dir: 'buy', sl: c.close - risk, tp: c.close + params.rr * risk, risk });
    } else if (r[i - 1] > params.rsiHigh && r[i] <= params.rsiHigh && c.close > m[i]) {
      Object.assign(s, { dir: 'sell', sl: c.close + risk, tp: c.close - params.rr * risk, risk });
    }
    return s;
  });
  return { params, ind: { rsi: r, sma: m, atr: a, close }, signals };
}

module.exports = {
  NAME: 'bounce',
  LABEL: 'Oversold bounce',
  DESCRIPTION: 'Bets that price snaps back toward its average after being stretched: buys when RSI recovers from oversold, sells when RSI falls back from overbought.',
  RULE: 'Buy when RSI turns back up through 30 while price is below its 20-bar average. Sell when RSI turns back down through 70 while price is above it.',
  selectedOnSeenData: false,
  DEFAULTS,
  GRID: { rsiLow: [20, 25, 30, 35], smaPeriod: [20, 50], atrMult: [1, 1.5, 2], rr: [1, 1.5, 2] },
  compute,
  describe: (ind, i, p) => [
    { label: 'RSI', value: ind.rsi[i] == null ? '--' : ind.rsi[i].toFixed(1) },
    { label: 'Versus average', value: ind.sma[i] == null ? '--' : `Price ${ind.close[i] > ind.sma[i] ? 'above' : 'below'} the ${p.smaPeriod}-bar average` },
    { label: 'ATR', value: ind.atr[i] == null ? '--' : ind.atr[i].toFixed(2) },
  ],
  derive: (p) => ({ ...p, rsiHigh: 100 - p.rsiLow }),
  valid: () => true,
  paramsText: (p) => `RSI ${p.rsiLow}/${p.rsiHigh ?? 100 - p.rsiLow}, ${p.smaPeriod}-bar average, stop ${p.atrMult}xATR, target ${p.rr}R`,
};
