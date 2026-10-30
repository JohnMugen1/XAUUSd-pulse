const test = require('node:test');
const assert = require('node:assert');
const stats = require('../src/lab/stats');
const quality = require('../src/lab/dataQuality');
const { runLab, buildCombos } = require('../src/lab/lab');
const strategies = require('../src/strategy');
const { simulate } = require('../src/strategy/engine');
const sample = require('../src/lib/sampleCandles');

test('bootstrap is repeatable and its interval is ordered', () => {
  const v = [1, -1, 2, -0.5, 1.5, -1, 0.5, 2, -1, 1];
  const a = stats.bootstrapMean(v), b = stats.bootstrapMean(v);
  assert.deepStrictEqual(a, b);
  assert.ok(a.p05 <= a.p50 && a.p50 <= a.p95);
});
test('bootstrap: clearly positive data is almost never negative, clearly negative data the reverse', () => {
  assert.ok(stats.bootstrapMean(Array.from({ length: 40 }, (_, i) => 1 + (i % 3) * 0.1)).probPositive > 0.99);
  assert.ok(stats.bootstrapMean(Array.from({ length: 40 }, (_, i) => -1 - (i % 3) * 0.1)).probPositive < 0.01);
  assert.strictEqual(stats.bootstrapMean([1]), null);
});
test('tstat: zero for constant values, positive for a consistent positive set', () => {
  assert.strictEqual(stats.tstat([1, 1, 1, 1]), 0);
  assert.ok(stats.tstat([1, 2, 1.5, 1.2, 1.8]) > 3);
});
test('periods group by the UTC year and quarter of the exit, sorted', () => {
  const t = (iso, pnl, r) => ({ exit_ts: Date.parse(iso) / 1000, pnl, r });
  const rows = stats.byPeriod([t('2025-02-01T00:00:00Z', 5, 1), t('2024-12-31T23:00:00Z', -3, -1), t('2025-02-10T00:00:00Z', -2, -0.5)], 'quarter');
  assert.deepStrictEqual(rows.map((r) => r.period), ['2024-Q4', '2025-Q1']);
  assert.strictEqual(rows[1].trades, 2);
  assert.strictEqual(stats.byPeriod([t('2025-02-01T00:00:00Z', 1, 1)], 'year')[0].period, '2025');
});
test('summarize: profit factor is null with no losing trades', () => {
  assert.strictEqual(stats.summarize([{ pnl: 2, r: 1 }]).profitFactor, null);
  assert.strictEqual(stats.summarize([]).trades, 0);
});

test('data quality flags flat and weekend-closure bars and cleaning removes them', () => {
  const at = (iso, h = 1, l = 0) => ({ ts: Date.parse(iso) / 1000, open: 1, high: h, low: l, close: 1 });
  const bars = [
    at('2026-10-21T10:00:00Z'),              // normal Wednesday
    at('2026-10-21T11:00:00Z', 1, 1),        // flat
    at('2026-10-24T10:00:00Z'),              // Saturday: closed
    at('2026-10-23T21:00:00Z'),              // Friday 21:00: still trading
    at('2026-10-23T22:00:00Z'),              // Friday 22:00: closed
    at('2026-10-25T21:00:00Z'),              // Sunday 21:00: closed
    at('2026-10-25T22:00:00Z'),              // Sunday 22:00: open again
  ];
  const q = quality.analyze(bars);
  assert.strictEqual(q.flatBars, 1);
  assert.strictEqual(q.weekendBars, 3);
  assert.deepStrictEqual(quality.clean(bars).map((b) => b.ts), [bars[0], bars[3], bars[6]].map((b) => b.ts));
});

test('grid: 243 valid combinations, fast average always below slow, sell level mirrors buy level', () => {
  const c = buildCombos(strategies.get('rsi_ema'));
  assert.strictEqual(c.length, 243);
  assert.ok(c.every((p) => p.emaFast < p.emaSlow && p.rsiSell === 100 - p.rsiBuy));
});
test('every strategy grid contains its own default settings, so the sweep can rank them', () => {
  for (const st of strategies.list) {
    const combos = buildCombos(st);
    const hit = combos.find((p) => Object.keys(st.GRID).every((k) => p[k] === st.DEFAULTS[k]));
    assert.ok(hit, st.NAME + ' default missing from its grid');
  }
});

test('every simulated trade carries its risk and R-multiple', () => {
  const candles = sample.generate('H1', 1792654000, 3000).slice(0, -1);
  const { trades } = simulate(candles);
  assert.ok(trades.length > 5);
  trades.forEach((t) => { assert.ok(t.risk > 0); assert.ok(Math.abs(t.r - t.pnl / t.risk) < 1e-9); });
});

test('lab: walk-forward never tests on data it trained on, and the verdict adds up', async () => {
  const candles = sample.generate('H1', 1792654000, 5000).slice(0, -1);
  const progress = [];
  const r = await runLab(candles, { onProgress: (p) => progress.push(p.pct), dataSource: 'sample' });
  const ok = r.walkForward.folds.filter((f) => !f.skipped);
  assert.ok(ok.length >= 1);
  ok.forEach((f) => { assert.ok(Date.parse(f.train.to) < Date.parse(f.test.from)); assert.ok(f.chosen.emaFast < f.chosen.emaSlow); });
  for (let i = 1; i < ok.length; i++) assert.ok(Date.parse(ok[i].test.from) >= Date.parse(ok[i - 1].test.to));
  assert.strictEqual(r.walkForward.pooledOptimized.trades, ok.reduce((s, f) => s + f.testOptimized.trades, 0));
  assert.strictEqual(r.verdict.total, 7);
  assert.strictEqual(r.verdict.passed, r.verdict.checks.filter((c) => c.pass).length);
  assert.strictEqual(r.costTests.length, 3);
  assert.ok(progress.length > 5 && progress.every((p, i) => i === 0 || p >= progress[i - 1] - 0) && progress[progress.length - 1] === 100);
});
test('lab refuses to run on too little data', async () => {
  await assert.rejects(runLab(sample.generate('H1', 1792654000, 200)), /at least 400 bars/);
});
