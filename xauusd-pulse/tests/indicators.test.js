const test = require('node:test');
const assert = require('node:assert');
const { ema, rsi, atr } = require('../src/lib/indicators');

test('EMA of a constant series is that constant', () => {
  const out = ema(new Array(30).fill(10), 5);
  assert.strictEqual(out[3], null);
  assert.ok(Math.abs(out[4] - 10) < 1e-9 && Math.abs(out[29] - 10) < 1e-9);
});

test('EMA reacts to a rising series but lags it', () => {
  const v = Array.from({ length: 40 }, (_, i) => i);
  const e = ema(v, 10);
  assert.ok(e[39] < 39 && e[39] > 28);
});

test('RSI is 100 when price only rises, 0 when it only falls, 50 when flat', () => {
  const up = rsi(Array.from({ length: 30 }, (_, i) => i), 14);
  const down = rsi(Array.from({ length: 30 }, (_, i) => 100 - i), 14);
  const flat = rsi(new Array(30).fill(5), 14);
  assert.strictEqual(up[29], 100);
  assert.ok(down[29] < 0.0001);
  assert.strictEqual(flat[29], 50);
  assert.strictEqual(up[13], null);
});

test('RSI stays within 0-100 on noisy data', () => {
  let x = 100; const c = [];
  for (let i = 0; i < 300; i++) { x += Math.sin(i * 1.7) * 2 + Math.cos(i * 0.3); c.push(x); }
  rsi(c, 14).filter((v) => v != null).forEach((v) => assert.ok(v >= 0 && v <= 100));
});

test('ATR of constant 2-point bars is 2', () => {
  const n = 40;
  const c = new Array(n).fill(100), h = new Array(n).fill(101), l = new Array(n).fill(99);
  const a = atr(h, l, c, 14);
  assert.ok(Math.abs(a[39] - 2) < 1e-9);
});
