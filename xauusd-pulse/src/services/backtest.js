const db = require('../db');
const defaultStrategy = require('../strategy/rsiEma');
const { findExit, simulate, metrics } = require('../strategy/engine');

const delRuns = db.prepare('DELETE FROM backtest_runs WHERE strategy = ? AND timeframe = ?');
const insRun = db.prepare(`INSERT INTO backtest_runs
  (run_at, strategy, timeframe, params_json, bars, profit_factor, win_rate, max_drawdown, net_profit)
  VALUES (?,?,?,?,?,?,?,?,?)`);
const insTrade = db.prepare(`INSERT INTO backtest_trades
  (run_id, direction, entry_ts, exit_ts, entry, exit, pnl) VALUES (?,?,?,?,?,?,?)`);

// Keeps only the latest run per strategy and timeframe (older runs and their trades are removed).
function runAndStore(tf, candles, dataSource, strat = defaultStrategy, overrides) {
  const res = simulate(candles, overrides, strat);
  const m = res.metrics;
  const meta = {
    params: res.params, dataSource,
    trades: m.trades, wins: m.wins, avgWin: m.avgWin, avgLoss: m.avgLoss, peak: m.peak, signals: res.signalCount,
    from: candles[0].ts, to: candles[candles.length - 1].ts,
  };
  db.transaction(() => {
    delRuns.run(strat.NAME, tf);
    const id = insRun.run(Math.floor(Date.now() / 1000), strat.NAME, tf, JSON.stringify(meta),
      candles.length, m.profitFactor, m.winRate, m.maxDrawdown, m.netProfit).lastInsertRowid;
    for (const t of res.trades) insTrade.run(id, t.direction, t.entry_ts, t.exit_ts, t.entry, t.exit, t.pnl);
  })();
  return res;
}

function getPerformance(tf, name = defaultStrategy.NAME) {
  const run = db.prepare('SELECT * FROM backtest_runs WHERE strategy = ? AND timeframe = ?').get(name, tf);
  if (!run) return { timeframe: tf, status: 'no-data' };
  const meta = JSON.parse(run.params_json);
  const trades = db.prepare(`SELECT direction, entry_ts, exit_ts, entry, exit, pnl
    FROM backtest_trades WHERE run_id = ? ORDER BY exit_ts DESC LIMIT 25`).all(run.id);
  return {
    timeframe: tf,
    status: 'ok',
    strategy: run.strategy,
    runAt: run.run_at,
    dataSource: meta.dataSource,
    window: { from: meta.from, to: meta.to, bars: run.bars },
    params: meta.params,
    metrics: {
      trades: meta.trades, wins: meta.wins, winRate: run.win_rate, profitFactor: run.profit_factor,
      netProfit: run.net_profit, maxDrawdown: run.max_drawdown, peak: meta.peak,
      avgWin: meta.avgWin, avgLoss: meta.avgLoss, signals: meta.signals ?? null,
    },
    trades,
  };
}

module.exports = { simulate, metrics, findExit, runAndStore, getPerformance };
