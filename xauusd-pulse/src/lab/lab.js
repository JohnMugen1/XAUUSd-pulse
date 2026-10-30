// Test lab: asks "is this strategy's edge real?" in several independent ways.
const { simulate } = require('../strategy/engine');
const defaultStrategy = require('../strategy/rsiEma');
const stats = require('./stats');
const quality = require('./dataQuality');

const COSTS = [0.35, 0.7, 1.0];
const MIN_TRAIN_TRADES = 15;
const MIN_ELIGIBLE_TRADES = 20;

// Every combination of the strategy's GRID that makes sense.
function buildCombos(strat) {
  const keys = Object.keys(strat.GRID);
  let out = [{}];
  for (const k of keys) out = out.flatMap((o) => strat.GRID[k].map((v) => ({ ...o, [k]: v })));
  return out.map((p) => strat.derive(p)).filter((p) => strat.valid(p));
}
const iso = (t) => new Date(t * 1000).toISOString();
const tick = () => new Promise((r) => setImmediate(r)); // lets the live price keep flowing while the lab works

async function runLab(rawCandles, { strategy = defaultStrategy, onProgress = () => {}, dataSource = 'unknown' } = {}) {
  if (rawCandles.length < 400) throw new Error(`Need at least 400 bars for the test lab, have ${rawCandles.length}.`);
  const all = buildCombos(strategy);
  const isDefault = (p) => Object.keys(strategy.GRID).every((k) => p[k] === strategy.DEFAULTS[k]);
  const sim = (c, o) => simulate(c, o, strategy);
  const text = (p) => strategy.paramsText(p);
  const total = 8 + all.length * 4;
  let done = 0, lastPct = 0;
  const step = async (label, every = 1) => {
    done++;
    if (done % every === 0) {
      lastPct = Math.max(lastPct, Math.min(99, Math.round((done / total) * 100))); // never goes backwards
      onProgress({ step: label, pct: lastPct });
      await tick();
    }
  };

  // 1. Data quality, and the same default strategy on raw vs cleaned data
  onProgress({ step: 'Checking the data', pct: 0 });
  const dq = quality.analyze(rawCandles);
  const candles = quality.clean(rawCandles);
  const rawSim = sim(rawCandles, {});
  const base = sim(candles, {});
  await step('Baseline');
  const dataQuality = {
    ...dq, cleanedBars: candles.length,
    rawResult: stats.summarize(rawSim.trades), cleanedResult: stats.summarize(base.trades),
  };

  // 2. Results by period
  const periods = { byYear: stats.byPeriod(base.trades, 'year'), byQuarter: stats.byPeriod(base.trades, 'quarter') };

  // 3. Cost sensitivity
  const costTests = [];
  for (const c of COSTS) {
    costTests.push({ costPerTrade: c, ...stats.summarize(sim(candles, { costPerTrade: c }).trades) });
    await step('Cost test');
  }

  // 4. Luck check
  const rs = base.trades.map((t) => t.r).filter(Number.isFinite);
  const bootstrap = stats.bootstrapMean(rs);
  await step('Luck check');

  // 5. Settings sweep on all data: does the edge survive nearby settings?
  const sweepRows = [];
  for (let i = 0; i < all.length; i++) {
    sweepRows.push({ params: all[i], ...stats.summarize(sim(candles, all[i]).trades) });
    await step('Settings sweep', 3);
  }
  const eligible = sweepRows.filter((r) => r.trades >= MIN_ELIGIBLE_TRADES);
  const byAvgR = [...eligible].sort((a, b) => b.avgR - a.avgR);
  const defaultRow = sweepRows.find((r) => isDefault(r.params));
  const medianAvgR = eligible.length ? stats.percentile(eligible.map((r) => r.avgR).sort((a, b) => a - b), 0.5) : null;
  const compact = (r) => ({ params: r.params, text: text(r.params), trades: r.trades, avgR: r.avgR, profitFactor: r.profitFactor, winRate: r.winRate });
  const sweep = {
    combos: all.length, eligible: eligible.length, minTrades: MIN_ELIGIBLE_TRADES,
    profitableShare: eligible.length ? eligible.filter((r) => r.avgR > 0).length / eligible.length : null,
    medianAvgR,
    best: byAvgR.slice(0, 5).map(compact),
    worst: byAvgR.slice(-3).reverse().map(compact),
    defaultRank: defaultRow && eligible.includes(defaultRow) ? byAvgR.indexOf(defaultRow) + 1 : null,
    defaultResult: defaultRow ? compact(defaultRow) : null,
  };

  // 6. Walk-forward: tune on the past, test on the next unseen chunk, three times
  const n = candles.length, chunk = Math.floor(n / 4);
  const folds = [];
  const oosOptTrades = [], oosDefTrades = [];
  for (let k = 1; k <= 3; k++) {
    const trainEnd = k * chunk;
    const testEnd = k === 3 ? n : (k + 1) * chunk;
    const train = candles.slice(0, trainEnd);
    let best = null;
    for (const p of all) {
      const rr = sim(train, p).trades.map((t) => t.r).filter(Number.isFinite);
      if (rr.length >= MIN_TRAIN_TRADES) {
        const score = stats.tstat(rr);
        if (!best || score > best.score) best = { params: p, score, trades: rr.length, avgR: stats.mean(rr) };
      }
      await step('Walk-forward tuning', 3);
    }
    if (!best) { folds.push({ fold: k, skipped: true, reason: 'No settings produced enough trades in the training period.' }); continue; }
    const testStart = candles[trainEnd].ts;
    const prefix = candles.slice(0, testEnd);
    const optTest = sim(prefix, best.params).trades.filter((t) => t.entry_ts >= testStart);
    const defTest = sim(prefix, {}).trades.filter((t) => t.entry_ts >= testStart);
    oosOptTrades.push(...optTest); oosDefTrades.push(...defTest);
    folds.push({
      fold: k,
      train: { from: iso(train[0].ts), to: iso(train[train.length - 1].ts), bars: train.length },
      test: { from: iso(testStart), to: iso(candles[testEnd - 1].ts), bars: testEnd - trainEnd },
      chosen: best.params, chosenText: text(best.params), trainTrades: best.trades, trainAvgR: best.avgR,
      testOptimized: stats.summarize(optTest), testDefault: stats.summarize(defTest),
    });
  }
  const walkForward = {
    folds, minTrainTrades: MIN_TRAIN_TRADES,
    pooledOptimized: stats.summarize(oosOptTrades),
    pooledDefault: stats.summarize(oosDefTrades),
  };

  // 7. Verdict: seven plain checks
  const baseSum = stats.summarize(base.trades);
  const qWith = periods.byQuarter.filter((q) => q.trades >= 3);
  const qGood = qWith.filter((q) => q.netR > 0).length;
  const cost2 = costTests.find((c) => c.costPerTrade === 0.7);
  const checks = [
    { id: 'positive', label: 'Profitable after costs on all data',
      pass: baseSum.avgR > 0 && (baseSum.profitFactor ?? Infinity) > 1,
      detail: `${baseSum.trades} trades, average ${baseSum.avgR.toFixed(2)}R per trade, profit factor ${baseSum.profitFactor == null ? 'n/a' : baseSum.profitFactor.toFixed(2)}` },
    { id: 'luck', label: 'Unlikely to be luck (90% or more)',
      pass: !!bootstrap && bootstrap.probPositive >= 0.9,
      detail: bootstrap ? `${Math.round(bootstrap.probPositive * 100)}% of resampled histories were profitable` : 'not enough trades' },
    { id: 'costs', label: 'Still profitable if costs double',
      pass: !!cost2 && cost2.trades > 0 && (cost2.profitFactor ?? Infinity) > 1,
      detail: cost2 ? `profit factor ${cost2.profitFactor == null ? 'n/a' : cost2.profitFactor.toFixed(2)} at ${cost2.costPerTrade} points per trade` : 'n/a' },
    { id: 'steady', label: 'Profitable in at least 60% of quarters',
      pass: qWith.length >= 3 && qGood / qWith.length >= 0.6,
      detail: qWith.length >= 3 ? `${qGood} of ${qWith.length} quarters (with 3 or more trades) were profitable` : 'fewer than 3 quarters had enough trades' },
    { id: 'broad', label: 'Works across nearby settings (60% or more)',
      pass: sweep.profitableShare != null && sweep.profitableShare >= 0.6,
      detail: sweep.profitableShare != null ? `${Math.round(sweep.profitableShare * 100)}% of ${sweep.eligible} tested settings were profitable` : 'not enough trades' },
    { id: 'oos', label: 'Profitable on unseen data (walk-forward)',
      pass: walkForward.pooledOptimized.trades >= 20 && walkForward.pooledOptimized.avgR > 0,
      detail: `${walkForward.pooledOptimized.trades} unseen trades, average ${walkForward.pooledOptimized.avgR.toFixed(2)}R per trade` },
    { id: 'size', label: 'Big enough sample (100 or more trades)',
      pass: baseSum.trades >= 100, detail: `${baseSum.trades} trades` },
  ];
  const passed = checks.filter((c) => c.pass).length;
  const verdict = {
    passed, total: checks.length, checks,
    label: passed >= 6 ? 'Promising' : passed >= 4 ? 'Mixed' : 'Not proven',
    note: 'A passing grade is a reason to keep testing (for example on a demo account), not a promise of future profit.' +
      (strategy.selectedOnSeenData ? ' Warning: this strategy\'s settings were chosen after looking at this same history, so these results are optimistic. Only live results can confirm it.' : ''),
  };

  onProgress({ step: 'Done', pct: 100 });
  return {
    ranAt: Math.floor(Date.now() / 1000), dataSource,
    strategy: { name: strategy.NAME, label: strategy.LABEL },
    window: { from: iso(candles[0].ts), to: iso(candles[candles.length - 1].ts), bars: candles.length },
    baseline: { ...baseSum, metrics: { maxDrawdownR: base.metrics.maxDrawdownR, maxLossStreak: base.metrics.maxLossStreak } },
    dataQuality, periods, costTests, bootstrap, sweep, walkForward, verdict,
  };
}

module.exports = { runLab, buildCombos };
