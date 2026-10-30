const { make } = require('./pullback');

// The original starting rule (v1). Kept unchanged so earlier results stay comparable.
module.exports = make({
  NAME: 'rsi_ema',
  LABEL: 'Trend pullback (v1)',
  DESCRIPTION: 'Buys small dips in an uptrend and sells small bounces in a downtrend, using a 21/50 average trend filter and RSI 40/60.',
  RULE: 'Buy when the fast average is above the slow one and RSI turns back up through 40. Sell is the mirror image through 60.',
  selectedOnSeenData: false,
  DEFAULTS: {
    emaFast: 21, emaSlow: 50, rsiPeriod: 14, rsiBuy: 40, rsiSell: 60,
    atrPeriod: 14, atrMult: 1.5, rr: 2, maxHoldBars: 48, costPerTrade: 0.35,
  },
  GRID: { emaFast: [13, 21, 34], emaSlow: [50, 100, 150], rsiBuy: [35, 40, 45], atrMult: [1, 1.5, 2], rr: [1.5, 2, 3] },
});
