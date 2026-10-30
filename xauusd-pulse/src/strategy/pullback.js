// Factory for "trend pullback" strategies:
//   BUY : fast EMA above slow EMA (uptrend) and RSI crosses back UP through rsiBuy
//   SELL: fast EMA below slow EMA (downtrend) and RSI crosses back DOWN through rsiSell
// Stop = atrMult x ATR from entry; target = rr x the stop distance.
const { ema, rsi, atr } = require('../lib/indicators');

function make(def) {
  const { DEFAULTS } = def;

  function compute(candles, overrides = {}) {
    const params = { ...DEFAULTS, ...overrides };
    if (overrides.rsiBuy != null && overrides.rsiSell == null) params.rsiSell = 100 - overrides.rsiBuy;
    const close = candles.map((c) => c.close);
    const high = candles.map((c) => c.high);
    const low = candles.map((c) => c.low);
    const ef = ema(close, params.emaFast);
    const es = ema(close, params.emaSlow);
    const r = rsi(close, params.rsiPeriod);
    const a = atr(high, low, close, params.atrPeriod);

    const signals = candles.map((c, i) => {
      const s = { dir: 'hold', entry: c.close, sl: null, tp: null, risk: null };
      if (i < 1 || ef[i] == null || es[i] == null || r[i] == null || r[i - 1] == null || a[i] == null) return s;
      const risk = params.atrMult * a[i];
      if (ef[i] > es[i] && r[i - 1] < params.rsiBuy && r[i] >= params.rsiBuy) {
        Object.assign(s, { dir: 'buy', sl: c.close - risk, tp: c.close + params.rr * risk, risk });
      } else if (ef[i] < es[i] && r[i - 1] > params.rsiSell && r[i] <= params.rsiSell) {
        Object.assign(s, { dir: 'sell', sl: c.close + risk, tp: c.close - params.rr * risk, risk });
      }
      return s;
    });
    return { params, ind: { ef, es, rsi: r, atr: a }, signals };
  }

  const describe = (ind, i, p) => [
    { label: 'Trend', value: `${ind.ef[i] > ind.es[i] ? 'Up' : 'Down'} (EMA${p.emaFast} ${ind.ef[i] > ind.es[i] ? '>' : '<'} EMA${p.emaSlow})` },
    { label: 'RSI', value: ind.rsi[i] == null ? '--' : ind.rsi[i].toFixed(1) },
    { label: 'ATR', value: ind.atr[i] == null ? '--' : ind.atr[i].toFixed(2) },
  ];

  return {
    ...def,
    compute, describe,
    derive: (p) => ({ ...p, rsiSell: 100 - p.rsiBuy }),
    valid: (p) => p.emaFast < p.emaSlow,
    paramsText: (p) => `EMA ${p.emaFast}/${p.emaSlow}, RSI ${p.rsiBuy}/${p.rsiSell ?? 100 - p.rsiBuy}, stop ${p.atrMult}xATR, target ${p.rr}R`,
  };
}

module.exports = { make };
