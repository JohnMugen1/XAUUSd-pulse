const test = require('node:test');
const assert = require('node:assert');
process.env.DB_PATH = ':memory:';
const db = require('../src/db');
const CandleService = require('../src/services/candles');
const sample = require('../src/lib/sampleCandles');
const TF = require('../src/lib/timeframes');

const NOW = Math.floor(Date.now() / 1000);
const cfg = (extra = {}) => ({
  timeframes: ['H4'],
  candles: { source: 'twelvedata', apiKey: 'k12345678', baseUrl: 'http://x', symbol: 'XAU/USD', historyYears: 3, pageDelayMs: 0, ...extra },
});
// a pretend provider holding years of H4 bars; it answers like Twelve Data: the latest page, or the page ending at end_date
function provider(startSec) {
  const all = sample.generate('H4', NOW, 1e9, startSec);
  return { all, fetch: async (tf, endTs) => { const rows = endTs ? all.filter((b) => b.ts <= endTs) : all; return rows.slice(-TF[tf].size); } };
}
function service(p, extra) {
  db.prepare('DELETE FROM candles').run();
  db.prepare("DELETE FROM meta WHERE key LIKE 'backfill%'").run();
  const s = new CandleService(cfg(extra));
  s.fetchTwelveData = p.fetch;
  return s;
}

test('backfill pages backwards until the target number of years is loaded', async () => {
  const p = provider(Date.UTC(2015, 0, 1) / 1000);
  const s = service(p);
  await s.refresh('H4');
  const afterFirst = s.historyInfo('H4');
  await s.backfill('H4');
  const h = s.historyInfo('H4');
  assert.ok(afterFirst.years < 2.5, 'one page is only about 2.5 years of weekday-less sample bars');
  assert.ok(h.years >= 3, `expected 3+ years of history, got ${h.years.toFixed(2)}`);
  assert.ok(h.bars > afterFirst.bars);
  assert.strictEqual(s.backfillState.H4.status, 'done');
  // the stored series is strictly increasing with no duplicates or overlaps
  const ts = db.prepare("SELECT ts FROM candles WHERE timeframe='H4' ORDER BY ts").all().map((r) => r.ts);
  assert.ok(ts.every((t, i) => i === 0 || t > ts[i - 1]));
});

test('backfill stops when the provider has nothing older, and is not repeated afterwards', async () => {
  const p = provider(Date.UTC(2025, 0, 1) / 1000); // only ~1.8 years exist at the provider
  let calls = 0;
  const s = service(p, { historyYears: 8 });
  const inner = s.fetchTwelveData;
  s.fetchTwelveData = async (...a) => { calls++; return inner(...a); };
  await s.refresh('H4');
  await s.backfill('H4');
  assert.strictEqual(s.backfillState.H4.status, 'done');
  const callsAfterFirst = calls;
  assert.ok(callsAfterFirst <= 4, 'must not loop forever, made ' + callsAfterFirst + ' requests');
  await s.backfill('H4'); // already finished: no more requests
  assert.strictEqual(calls, callsAfterFirst);
});

test('backfill pauses on a provider error and keeps everything already loaded', async () => {
  const p = provider(Date.UTC(2015, 0, 1) / 1000);
  const s = service(p, { historyYears: 8 });
  await s.refresh('H4');
  const before = s.historyInfo('H4').bars;
  let n = 0;
  const inner = s.fetchTwelveData;
  s.fetchTwelveData = async (...a) => { if (++n >= 2) throw new Error('Twelve Data: rate limit'); return inner(...a); };
  await s.backfill('H4');
  assert.strictEqual(s.backfillState.H4.status, 'paused');
  assert.match(s.backfillState.H4.error, /rate limit/);
  assert.ok(s.historyInfo('H4').bars >= before);
  assert.strictEqual(db.getMeta('backfill_done_H4'), undefined, 'a paused load is retried later');
  s.stop();
});

test('sample mode has no backfill, and switching source resets the backfill note', async () => {
  const s = new CandleService({ timeframes: ['H4'], candles: { source: 'sample', apiKey: '', baseUrl: 'http://x', symbol: 'XAU/USD', historyYears: 3, pageDelayMs: 0 } });
  await s.backfill('H4');
  assert.strictEqual(s.backfillState.H4, undefined);
  db.setMeta('backfill_done_H4', 'done');
  s.purgeAll();
  assert.strictEqual(db.getMeta('backfill_done_H4'), undefined);
});

test('sample mode produces years of history when asked for the deep range', () => {
  const bars = sample.generate('H4', NOW, TF.H4.maxBars, sample.DEEP_START);
  const years = (bars[bars.length - 1].ts - bars[0].ts) / (365.25 * 86400);
  assert.ok(years > 7, 'expected 7+ years, got ' + years.toFixed(1));
  assert.ok(bars.every((b) => b.close > 0 && b.high >= b.low));
});

test('sample data can be anchored to a realistic price, and the default sequence is unchanged', () => {
  const plain = sample.generate('H4', NOW, 500);
  const same = sample.generate('H4', NOW, 500, undefined, null);
  assert.deepStrictEqual(plain, same);
  const anchored = sample.generate('H4', NOW, 500, sample.DEEP_START, 4100);
  assert.ok(Math.abs(anchored[anchored.length - 1].close - 4100) < 1);
  assert.ok(anchored.every((b) => b.low > 500 && b.high < 20000), 'prices stay in a believable range');
});
