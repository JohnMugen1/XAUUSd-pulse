const { make } = require('./pullback');

// Same idea as v1 with the settings that looked best in the first Test lab run (slow trend, wide stop and target).
// IMPORTANT: these settings were chosen after looking at the same history, so lab results for this strategy are
// optimistic. Only live (forward) results can confirm it.
module.exports = make({
  NAME: 'pullback_v2',
  LABEL: 'Trend pullback (v2, slow trend)',
  DESCRIPTION: 'The same dip-buying idea as v1 but with a slower trend filter (21/100), RSI 45/55, a wider stop (2x ATR) and a 3R target.',
  RULE: 'Buy when the 21 average is above the 100 average and RSI turns back up through 45. Sell is the mirror image through 55.',
  selectedOnSeenData: true,
  DEFAULTS: {
    emaFast: 21, emaSlow: 100, rsiPeriod: 14, rsiBuy: 45, rsiSell: 55,
    atrPeriod: 14, atrMult: 2, rr: 3, maxHoldBars: 48, costPerTrade: 0.35,
  },
  GRID: { emaFast: [13, 21, 34], emaSlow: [100, 150, 200], rsiBuy: [40, 45, 50], atrMult: [1.5, 2, 2.5], rr: [2, 3, 4] },
});
