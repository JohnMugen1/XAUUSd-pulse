const test = require('node:test');
const assert = require('node:assert');
process.env.DB_PATH = ':memory:';
const { findExit, simulate, metrics } = require('../src/services/backtest');
const sample = require('../src/lib/sampleCandles');

const bar = (o, h, l, c) => ({ ts: 0, open: o, high: h, low: l, close: c });

test('buy trade hits take profit', () => {
  const c = [bar(100, 101, 99.5, 100), bar(100, 106, 99.6, 105)];
  assert.deepStrictEqual(findExit(c, 1, 'buy', 98, 105, 10), { j: 1, price: 105, reason: 'tp' });
});

test('buy trade hits stop loss', () => {
  const c = [bar(100, 101, 99.5, 100), bar(100, 100.5, 97, 98)];
  assert.deepStrictEqual(findExit(c, 1, 'buy', 98, 105, 10), { j: 1, price: 98, reason: 'sl' });
});

test('stop is assumed first when one bar touches both levels', () => {
  const c = [bar(100, 101, 99, 100), bar(100, 110, 90, 100)];
  assert.strictEqual(findExit(c, 1, 'buy', 98, 105, 10).reason, 'sl');
  assert.strictEqual(findExit(c, 1, 'sell', 102, 95, 10).reason, 'sl');
});

test('sell trade hits take profit', () => {
  const c = [bar(100, 101, 99, 100), bar(100, 100.4, 94, 95)];
  assert.deepStrictEqual(findExit(c, 1, 'sell', 102, 95, 10), { j: 1, price: 95, reason: 'tp' });
});

test('trade exits on time when neither level is hit, and stays open if data ends first', () => {
  const quiet = [bar(100, 100.5, 99.5, 100), bar(100, 100.5, 99.5, 100.2), bar(100, 100.5, 99.5, 100.1), bar(100, 100.5, 99.5, 100.3)];
  assert.strictEqual(findExit(quiet, 1, 'buy', 90, 110, 2).reason, 'time');
  assert.strictEqual(findExit(quiet, 1, 'buy', 90, 110, 50), null);
});

test('metrics: profit factor, win rate and drawdown', () => {
  const t = [{ pnl: 10 }, { pnl: -5 }, { pnl: -5 }, { pnl: 20 }];
  const m = metrics(t);
  assert.strictEqual(m.trades, 4);
  assert.strictEqual(m.winRate, 0.5);
  assert.strictEqual(m.profitFactor, 3);
  assert.strictEqual(m.netProfit, 20);
  assert.strictEqual(m.maxDrawdown, 10);
});

test('metrics with no losing trades gives null profit factor, and empty list is safe', () => {
  assert.strictEqual(metrics([{ pnl: 3 }]).profitFactor, null);
  const e = metrics([]);
  assert.strictEqual(e.trades, 0);
  assert.strictEqual(e.winRate, 0);
});

test('simulation on sample candles is internally consistent', () => {
  const now = Math.floor(Date.now() / 1000);
  const candles = sample.generate('H1', now, 2000).slice(0, -1);
  const { trades, metrics: m } = simulate(candles);
  assert.ok(trades.length >= 10, 'expected a meaningful number of trades, got ' + trades.length);
  const res = simulate(candles);
  assert.ok(res.signalCount >= trades.length, 'cannot complete more trades than signals');
  const sum = trades.reduce((s, t) => s + t.pnl, 0);
  assert.ok(Math.abs(sum - m.netProfit) < 1e-6);
  assert.ok(m.winRate >= 0 && m.winRate <= 1);
  for (let i = 0; i < trades.length; i++) {
    assert.ok(trades[i].exit_ts >= trades[i].entry_ts);
    if (i > 0) assert.ok(trades[i].entry_ts > trades[i - 1].entry_ts, 'trades must not overlap');
  }
});

test('simulation is deterministic: same candles give the same result', () => {
  const candles = sample.generate('H4', 1792000000, 1500).slice(0, -1);
  assert.deepStrictEqual(simulate(candles).metrics, simulate(candles).metrics);
});
