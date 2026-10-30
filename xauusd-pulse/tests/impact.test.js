const test = require('node:test');
const assert = require('node:assert');
const { analyze } = require('../src/lib/impact');
const { computeSentiment } = require('../src/lib/sentiment');
const { isRelevant } = require('../src/services/news');
process.env.DB_PATH = ':memory:';

const cases = [
  ['Gold climbs as dollar slips ahead of Fed decision', 'bullish', 'bearish'],
  ['Treasury yields rise as US jobs report beats expectations', 'bearish', 'bullish'],
  ['Fed officials signal rate cuts could be delayed as inflation proves sticky', 'bearish', 'bullish'],
  ['Dollar index falls to two-week low on weak retail sales data', 'bullish', 'bearish'],
  ['US inflation cools in latest CPI reading, rate-cut hopes grow', 'bullish', 'bearish'],
  ['Gold falls as dollar rises', 'bearish', 'bullish'],
  ['Oil steadies as traders await US data', 'neutral', 'neutral'],
];
for (const [title, gold, usd] of cases) {
  test('impact: ' + title, () => {
    const a = analyze(title);
    assert.strictEqual(a.goldBias, gold);
    assert.strictEqual(a.usdBias, usd);
    assert.ok(a.reason.length > 10);
  });
}

test('impact: empty or odd input never throws', () => {
  assert.doesNotThrow(() => { analyze(''); analyze(null); analyze(undefined); analyze('!!!'); });
});

test('relevance filter keeps market news and drops unrelated news', () => {
  assert.ok(isRelevant('Powell says Fed will watch inflation'));
  assert.ok(!isRelevant('Local team wins the cup final'));
});

test('sentiment: newer headlines weigh more, few headlines are shrunk toward neutral', () => {
  const now = 1_000_000;
  const old = { published_at: now - 20 * 3600, score: -0.8, usd_score: 0 };
  const fresh = { published_at: now - 600, score: 0.8, usd_score: 0 };
  const s = computeSentiment([old, fresh], now);
  assert.ok(s.gold.score > 0);
  const one = computeSentiment([fresh], now);
  assert.ok(one.gold.score < 0.8 && one.gold.score > 0);
  assert.strictEqual(computeSentiment([], now).gold.label, 'Neutral');
  assert.strictEqual(computeSentiment([{ published_at: now, score: 0, usd_score: 0 }], now).gold.count, 0);
});
