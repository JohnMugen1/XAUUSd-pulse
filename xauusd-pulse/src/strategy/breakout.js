// Breakout: trade in the direction of the trend when price closes beyond its recent range.
//   BUY : close above the highest high of the previous `lookback` bars, while price is above the trend average
//   SELL: close below the lowest low of the previous `lookback` bars, while price is below the trend average
const { ema, atr, highest, lowest } = require('../lib/indicators');

const DEFAULTS = { lookback: 20, trendPeriod: 100, atrPeriod: 14, atrMult: 2, rr: 2, maxHoldBars: 48, costPerTrade: 0.35 };

function compute(candles, overrides = {}) {
  const params = { ...DEFAULTS, ...overrides };
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const hh = highest(high, params.lookback);
  const ll = lowest(low, params.lookback);
  const te = ema(close, params.trendPeriod);
  const a = atr(high, low, close, params.atrPeriod);

  const signals = candles.map((c, i) => {
    const s = { dir: 'hold', entry: c.close, sl: null, tp: null, risk: null };
    if (i < 1 || hh[i] == null || hh[i - 1] == null || ll[i] == null || ll[i - 1] == null || te[i] == null || a[i] == null) return s;
    const risk = params.atrMult * a[i];
    const firstUp = c.close > hh[i] && !(close[i - 1] > hh[i - 1]); // only the first bar of a breakout
    const firstDown = c.close < ll[i] && !(close[i - 1] < ll[i - 1]);
    if (firstUp && c.close > te[i]) Object.assign(s, { dir: 'buy', sl: c.close - risk, tp: c.close + params.rr * risk, risk });
    else if (firstDown && c.close < te[i]) Object.assign(s, { dir: 'sell', sl: c.close + risk, tp: c.close - params.rr * risk, risk });
    return s;
  });
  return { params, ind: { hh, ll, te, atr: a, close }, signals };
}

module.exports = {
  NAME: 'breakout',
  LABEL: 'Breakout',
  DESCRIPTION: 'Buys when price closes above its recent high (in an uptrend) and sells when it closes below its recent low (in a downtrend).',
  RULE: 'Buy when a bar closes above the highest high of the last 20 bars and price is above its 100-bar average. Sell is the mirror image.',
  selectedOnSeenData: false,
  DEFAULTS,
  GRID: { lookback: [10, 20, 40], trendPeriod: [50, 100, 200], atrMult: [1.5, 2, 3], rr: [1.5, 2, 3] },
  compute,
  describe: (ind, i, p) => [
    { label: 'Range high', value: ind.hh[i] == null ? '--' : ind.hh[i].toFixed(2) },
    { label: 'Range low', value: ind.ll[i] == null ? '--' : ind.ll[i].toFixed(2) },
    { label: 'Trend filter', value: ind.te[i] == null ? '--' : `Price ${ind.close[i] > ind.te[i] ? 'above' : 'below'} the ${p.trendPeriod}-bar average` },
    { label: 'ATR', value: ind.atr[i] == null ? '--' : ind.atr[i].toFixed(2) },
  ],
  derive: (p) => p,
  valid: () => true,
  paramsText: (p) => `${p.lookback}-bar range, trend average ${p.trendPeriod}, stop ${p.atrMult}xATR, target ${p.rr}R`,
};
