// Deterministic FAKE candles so the whole system can run without an API key.
// The numbers mean nothing: never judge the strategy on sample data.
const TF = require('./timeframes');

const START = Date.UTC(2026, 0, 1) / 1000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(tf, nowSec, count, startSec = START, anchorLast = null) {
  const sec = TF[tf].sec;
  const rnd = mulberry32(12345 + sec);
  const scale = Math.sqrt(sec / 3600);
  const vol = 0.0016 * scale;
  const first = Math.floor(startSec / sec) * sec;
  const last = Math.floor(nowSec / sec) * sec; // includes the still-forming bar
  let price = 3900, trend = 0;
  const bars = [];
  for (let t = first; t <= last; t += sec) {
    trend = trend * 0.96 + (rnd() - 0.5) * 0.0008 * scale;
    const open = price;
    const close = open * (1 + trend + (rnd() - 0.5) * 2 * vol * 1.7);
    const span = Math.abs(open - close) + open * vol * rnd() * 1.2;
    const high = Math.max(open, close) + span * rnd() * 0.5;
    const low = Math.min(open, close) - span * rnd() * 0.5;
    bars.push({ ts: t, open, high, low, close });
    price = close;
  }
  const k = anchorLast ? anchorLast / bars[bars.length - 1].close : 1; // keeps demo prices realistic
  const r = (x) => Math.round(x * k * 100) / 100;
  return bars.slice(-count).map((b) => ({ ts: b.ts, open: r(b.open), high: r(b.high), low: r(b.low), close: r(b.close) }));
}

const DEEP_START = Date.UTC(2018, 0, 1) / 1000; // used by sample mode to mimic years of history

module.exports = { generate, DEEP_START };
