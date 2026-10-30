const test = require('node:test');
const assert = require('node:assert');
process.env.DB_PATH = ':memory:';
const strategies = require('../src/strategy');
const sample = require('../src/lib/sampleCandles');
const { simulate } = require('../src/strategy/engine');
const { sma, highest, lowest } = require('../src/lib/indicators');

test('sma, highest and lowest are correct and exclude the current bar for channels', () => {
  assert.deepStrictEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepStrictEqual(highest([1, 5, 2, 3, 9], 2), [null, null, 5, 5, 3]);
  assert.deepStrictEqual(lowest([4, 1, 3, 2, 0], 2), [null, null, 1, 1, 2]);
});

test('four strategies are registered, with unique names and complete definitions', () => {
  assert.strictEqual(strategies.list.length, 4);
  assert.strictEqual(new Set(strategies.list.map((s) => s.NAME)).size, 4);
  for (const st of strategies.list) {
    for (const f of ['NAME', 'LABEL', 'DESCRIPTION', 'RULE', 'DEFAULTS', 'GRID', 'compute', 'describe', 'derive', 'valid', 'paramsText']) assert.ok(st[f] !== undefined, `${st.NAME} missing ${f}`);
    assert.ok(st.DEFAULTS.rr > 0 && st.DEFAULTS.maxHoldBars > 0 && st.DEFAULTS.costPerTrade >= 0);
  }
  assert.strictEqual(strategies.get('nope'), null);
});

test('v2 uses the slower settings and is flagged as chosen on seen data; v1 is unchanged', () => {
  const v1 = strategies.get('rsi_ema'), v2 = strategies.get('pullback_v2');
  assert.strictEqual(v1.DEFAULTS.emaSlow, 50); assert.strictEqual(v1.DEFAULTS.rsiBuy, 40);
  assert.strictEqual(v2.DEFAULTS.emaSlow, 100); assert.strictEqual(v2.DEFAULTS.rr, 3);
  assert.strictEqual(v1.selectedOnSeenData, false); assert.strictEqual(v2.selectedOnSeenData, true);
});

for (const st of strategies.list) {
  test(`${st.NAME}: signals are well-formed (stop and target on the correct sides, positive risk)`, () => {
    const c = sample.generate('H1', 1792654000, 4000).slice(0, -1);
    const r = st.compute(c);
    assert.strictEqual(r.signals.length, c.length);
    const hits = r.signals.filter((s) => s.dir !== 'hold');
    assert.ok(hits.length >= 5, 'expected some signals, got ' + hits.length);
    for (const s of hits) {
      assert.ok(s.risk > 0);
      if (s.dir === 'buy') assert.ok(s.sl < s.entry && s.tp > s.entry);
      else assert.ok(s.sl > s.entry && s.tp < s.entry);
    }
    // the description helper works on the latest bar and returns label/value pairs
    const d = st.describe(r.ind, c.length - 1, r.params);
    assert.ok(d.length >= 2 && d.every((x) => x.label && typeof x.value === 'string'));
  });
  test(`${st.NAME}: no look-ahead (the signal at a bar does not change when later bars are added)`, () => {
    const c = sample.generate('H1', 1792654000, 3000).slice(0, -1);
    const full = st.compute(c).signals, cut = st.compute(c.slice(0, 2000)).signals;
    for (let i = 0; i < 2000; i++) assert.strictEqual(cut[i].dir, full[i].dir);
  });
  test(`${st.NAME}: simulation trades are consistent (R matches pnl/risk, no overlap)`, () => {
    const c = sample.generate('H4', 1792654000, 5000).slice(0, -1);
    const { trades } = simulate(c, {}, st);
    trades.forEach((t, i) => {
      assert.ok(Math.abs(t.r - t.pnl / t.risk) < 1e-9);
      if (i > 0) assert.ok(t.entry_ts > trades[i - 1].entry_ts);
    });
  });
}
