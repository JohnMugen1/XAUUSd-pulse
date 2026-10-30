// Small statistics helpers for the test lab. Pure functions, no database.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
};
// How many standard errors the average sits above zero. Rewards a result that is both positive and consistent.
const tstat = (a) => {
  const s = sd(a);
  return a.length >= 2 && s > 0 ? mean(a) / (s / Math.sqrt(a.length)) : 0;
};
const percentile = (sortedAsc, p) => {
  if (!sortedAsc.length) return null;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
};

// Resample the trades with replacement many times to see how much the average could be luck.
function bootstrapMean(values, iters = 2000, seed = 42) {
  if (values.length < 2) return null;
  const rnd = mulberry32(seed), n = values.length;
  const means = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += values[(rnd() * n) | 0];
    means[i] = s / n;
  }
  means.sort((x, y) => x - y);
  return {
    p05: percentile(means, 0.05), p50: percentile(means, 0.5), p95: percentile(means, 0.95),
    probPositive: means.filter((x) => x > 0).length / iters, iters,
  };
}

function summarize(trades) {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const gw = sum(wins.map((t) => t.pnl));
  const gl = -sum(trades.filter((t) => t.pnl <= 0).map((t) => t.pnl));
  const rs = trades.map((t) => t.r).filter(Number.isFinite);
  return {
    trades: n, wins: wins.length, winRate: n ? wins.length / n : 0,
    netPoints: sum(trades.map((t) => t.pnl)),
    netR: sum(rs), avgR: rs.length ? sum(rs) / rs.length : 0,
    profitFactor: gl > 0 ? gw / gl : null,
  };
}

function periodKey(tsSec, kind) {
  const d = new Date(tsSec * 1000);
  const y = d.getUTCFullYear();
  return kind === 'year' ? String(y) : `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

// Group trades by the period in which they were closed.
function byPeriod(trades, kind) {
  const map = new Map();
  for (const t of trades) {
    const k = periodKey(t.exit_ts, kind);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map.keys()].sort().map((k) => ({ period: k, ...summarize(map.get(k)) }));
}

module.exports = { mulberry32, mean, sd, tstat, percentile, bootstrapMean, summarize, periodKey, byPeriod };
