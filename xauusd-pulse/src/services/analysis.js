const db = require('../db');
const bus = require('../bus');
const TF = require('../lib/timeframes');
const strategies = require('../strategy');
const backtest = require('./backtest');

const insSignal = db.prepare(`INSERT OR IGNORE INTO signals
  (ts, timeframe, strategy, direction, entry, stop_loss, take_profit, rsi, ema_fast, ema_slow)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);

const LIVE_BARS = 3000;

class Analysis {
  constructor(candleService, journal) {
    this.candles = candleService;
    this.journal = journal;
    this.state = {};
    this.lastBar = {};
    this.errors = {};
  }

  dataSource() { return this.candles.source; }

  reset() { this.state = {}; this.lastBar = {}; this.errors = {}; bus.notify('signal'); bus.notify('performance'); }

  closedCandles(tf) {
    const sec = TF[tf].sec;
    const now = Math.floor(Date.now() / 1000);
    return db.prepare('SELECT ts, open, high, low, close FROM candles WHERE timeframe = ? ORDER BY ts DESC LIMIT ?')
      .all(tf, TF[tf].maxBars).reverse().filter((r) => r.ts + sec <= now); // drop the bar still forming
  }

  // After older history arrives, every strategy's backtest must be recomputed once.
  invalidate(tf) { for (const st of strategies.list) delete this.lastBar[`${st.NAME}:${tf}`]; }

  // Recompute every strategy's latest signal, re-run its backtest when a new bar has closed, and update the live journal.
  run(tf) {
    const all = this.closedCandles(tf);
    const closed = all.slice(-LIVE_BARS); // signals and the journal only need recent bars; backtests use everything
    if (closed.length < 80) {
      for (const st of strategies.list) this.state[`${st.NAME}:${tf}`] = { status: 'no-data', timeframe: tf, bars: closed.length };
      return;
    }
    for (const st of strategies.list) {
      try { this.runOne(st, tf, closed, all); } catch (err) {
        this.errors[`${st.NAME}:${tf}`] = err.message;
        console.error(`[analysis] ${st.NAME} ${tf} failed:`, err);
      }
    }
    if (this.journal) this.journal.update(tf, closed);
  }

  runOne(st, tf, closed, all) {
    const key = `${st.NAME}:${tf}`;
    const sec = TF[tf].sec;
    const { params, ind, signals } = st.compute(closed);
    const last = closed.length - 1;
    const s = signals[last];

    let lastAction = null;
    for (let i = last; i >= 0; i--) {
      if (signals[i].dir !== 'hold') {
        lastAction = { direction: signals[i].dir, time: closed[i].ts + sec, entry: signals[i].entry,
          stopLoss: signals[i].sl, takeProfit: signals[i].tp, barsAgo: last - i };
        break;
      }
    }

    const closeTime = closed[last].ts + sec;
    if (s.dir !== 'hold') {
      insSignal.run(closeTime, tf, st.NAME, s.dir, s.entry, s.sl, s.tp,
        ind.rsi ? ind.rsi[last] : null, ind.ef ? ind.ef[last] : null, ind.es ? ind.es[last] : null);
    }

    this.state[key] = {
      status: 'ok', timeframe: tf,
      strategy: { name: st.NAME, label: st.LABEL, rule: st.RULE, selectedOnSeenData: !!st.selectedOnSeenData },
      asOf: closeTime, direction: s.dir,
      entry: s.dir === 'hold' ? null : s.entry, stopLoss: s.sl, takeProfit: s.tp,
      close: closed[last].close,
      details: st.describe(ind, last, params),
      lastAction,
    };

    if (this.lastBar[key] !== closed[last].ts) {
      try {
        backtest.runAndStore(tf, all, this.dataSource(), st);
        this.lastBar[key] = closed[last].ts; // only remembered after success, so a failure is retried next time
        this.errors[key] = null;
      } catch (err) {
        this.errors[key] = err.message;
        console.error(`[analysis] ${key} backtest failed:`, err);
      }
      bus.notify('signal');
      bus.notify('performance');
    }
  }

  getSignal(tf, name = strategies.DEFAULT_NAME) {
    return { ...(this.state[`${name}:${tf}`] || { status: 'no-data', timeframe: tf }), dataSource: this.dataSource() };
  }
}

module.exports = Analysis;
