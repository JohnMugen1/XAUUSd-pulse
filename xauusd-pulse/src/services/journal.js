const db = require('../db');
const bus = require('../bus');
const TF = require('../lib/timeframes');
const strategies = require('../strategy');
const { findExit } = require('../strategy/engine');
const stats = require('../lab/stats');

const FORWARD_MIN_TRADES = 20;

// The live signal journal (forward test). Every signal that arrives AFTER the journal started is recorded and
// followed to its real outcome, using the same rules as the backtest. Nothing is back-filled, so these results
// cannot be flattered by hindsight.
class Journal {
  constructor({ notifications, labVerdict, pauseAt }) {
    this.notifications = notifications;
    this.pauseAt = pauseAt || (() => null); // (signalTs) -> the event whose pause window contains it, or null
    this.labVerdict = labVerdict || (() => null); // (strategyName, tf) -> 'Promising' | 'Mixed' | 'Not proven' | null
  }

  update(tf, closed, nowSec = Math.floor(Date.now() / 1000)) {
    for (const st of strategies.list) {
      try { this.updateOne(st, tf, closed, nowSec); } catch (err) { console.error(`[journal] ${st.NAME} ${tf} failed:`, err.message); }
    }
  }

  updateOne(st, tf, closed, nowSec) {
    if (closed.length < 80) return;
    const sec = TF[tf].sec;
    const startKey = `journal_start_${st.NAME}_${tf}`;
    let start = Number(db.getMeta(startKey));
    if (!start) { start = closed[closed.length - 1].ts + sec; db.setMeta(startKey, String(start)); }

    const { params, signals } = st.compute(closed);
    const idxByTs = new Map(closed.map((c, i) => [c.ts, i]));
    let changed = false;

    const resolve = () => {
      const open = db.prepare("SELECT * FROM journal WHERE strategy = ? AND timeframe = ? AND status IN ('pending','open') ORDER BY signal_ts").all(st.NAME, tf);
      for (const row of open) {
        const k = idxByTs.get(row.signal_ts); // the bar that opens right after the signal
        if (k == null) continue;
        const entry = closed[k].open;
        const sl = row.direction === 'buy' ? entry - row.risk : entry + row.risk;
        const tp = row.direction === 'buy' ? entry + params.rr * row.risk : entry - params.rr * row.risk;
        const ex = findExit(closed, k, row.direction, sl, tp, params.maxHoldBars);
        if (!ex) {
          if (row.status !== 'open') { db.prepare("UPDATE journal SET status='open', entry=?, entry_ts=? WHERE id=?").run(entry, closed[k].ts, row.id); changed = true; }
          continue;
        }
        const gross = row.direction === 'buy' ? ex.price - entry : entry - ex.price;
        const pnl = gross - params.costPerTrade;
        db.prepare("UPDATE journal SET status='closed', entry=?, entry_ts=?, exit_price=?, exit_ts=?, pnl=?, r=?, reason=? WHERE id=?")
          .run(entry, closed[k].ts, ex.price, closed[ex.j].ts, pnl, pnl / row.risk, ex.reason, row.id);
        changed = true;
      }
    };

    // record new signals in order, one trade at a time (same rule as the backtest)
    const from = closed.findIndex((c) => c.ts + sec > start);
    for (let i = from < 0 ? closed.length : from; i < closed.length; i++) {
      const s = signals[i];
      if (s.dir === 'hold') continue;
      const sigTs = closed[i].ts + sec;
      if (db.prepare('SELECT 1 FROM journal WHERE strategy=? AND timeframe=? AND signal_ts=?').get(st.NAME, tf, sigTs)) continue;
      resolve();
      const prev = db.prepare("SELECT status, exit_ts FROM journal WHERE strategy=? AND timeframe=? AND status != 'skipped' ORDER BY signal_ts DESC LIMIT 1").get(st.NAME, tf);
      const busy = prev && (prev.status === 'pending' || prev.status === 'open' || prev.exit_ts > sigTs - sec);
      const pause = this.pauseAt(sigTs);
      db.prepare(`INSERT INTO journal (strategy, timeframe, signal_ts, direction, signal_close, risk, status, created_at, blackout)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(st.NAME, tf, sigTs, s.dir, s.entry, s.risk, busy ? 'skipped' : 'pending', nowSec, pause ? 1 : 0);
      changed = true;
      if (!busy && nowSec - sigTs <= 2 * sec) this.alertSignal(st, tf, s, sigTs, pause);
    }
    resolve();
    if (changed) { this.evaluateForward(st, tf); bus.notify('journal'); }
  }

  // A live-signal message appears only for strategies that currently pass the lab.
  alertSignal(st, tf, s, sigTs, pause) {
    if (this.labVerdict(st.NAME, tf) !== 'Promising') return;
    const f = (x) => Number(x).toFixed(2);
    if (pause) {
      this.notifications.add({
        level: 'warning', kind: 'signal_paused', strategy: st.NAME, timeframe: tf,
        title: `Signal on hold: ${s.dir.toUpperCase()} on ${tf} (${st.LABEL})`,
        body: `${pause.name} (a high-impact US event) is inside the pause window, so this signal is held back. Many traders stay out until the news has passed. Entry about ${f(s.entry)}, stop ${f(s.sl)}, target ${f(s.tp)}. The backtests do not include this pause rule. Analysis only, not financial advice.`,
        dedupe: `sig:${st.NAME}:${tf}:${sigTs}`,
      });
      return;
    }
    this.notifications.add({
      level: 'signal', kind: 'signal', strategy: st.NAME, timeframe: tf,
      title: `${s.dir.toUpperCase()} signal on ${tf}: ${st.LABEL}`,
      body: `Entry about ${f(s.entry)}, stop loss ${f(s.sl)}, take profit ${f(s.tp)}. This strategy currently passes the test lab. Analysis only, not financial advice. Try it on a demo account first.`,
      dedupe: `sig:${st.NAME}:${tf}:${sigTs}`,
    });
  }

  evaluateForward(st, tf) {
    const sum = this.summary(st.NAME, tf);
    if (sum.closed < FORWARD_MIN_TRADES) return;
    const bucket = Math.floor(sum.closed / 10);
    if (sum.avgR > 0) {
      this.notifications.add({ level: 'success', kind: 'forward_good', strategy: st.NAME, timeframe: tf,
        title: `Live results look good: ${st.LABEL} on ${tf}`,
        body: `${sum.closed} live trades so far, average ${sum.avgR.toFixed(2)}R per trade (${sum.wins} wins). Live results are the best evidence, but still not a promise of future profit.`,
        dedupe: `fwdgood:${st.NAME}:${tf}:${bucket}` });
    } else {
      this.notifications.add({ level: 'warning', kind: 'forward_bad', strategy: st.NAME, timeframe: tf,
        title: `Live results are negative: ${st.LABEL} on ${tf}`,
        body: `${sum.closed} live trades so far, average ${sum.avgR.toFixed(2)}R per trade. Do not rely on this strategy.`,
        dedupe: `fwdbad:${st.NAME}:${tf}:${bucket}` });
    }
  }

  summary(strategy, tf) {
    const rows = db.prepare("SELECT status, pnl, r, blackout FROM journal WHERE strategy=? AND timeframe=?").all(strategy, tf);
    const closed = rows.filter((r) => r.status === 'closed');
    const rs = closed.map((r) => r.r);
    const gw = closed.filter((r) => r.pnl > 0).reduce((s, r) => s + r.pnl, 0);
    const gl = -closed.filter((r) => r.pnl <= 0).reduce((s, r) => s + r.pnl, 0);
    const start = Number(db.getMeta(`journal_start_${strategy}_${tf}`)) || null;
    return {
      startedAt: start,
      signals: rows.length, skipped: rows.filter((r) => r.status === 'skipped').length,
      pending: rows.filter((r) => r.status === 'pending').length, open: rows.filter((r) => r.status === 'open').length,
      closed: closed.length, wins: closed.filter((r) => r.pnl > 0).length,
      netR: rs.reduce((a, b) => a + b, 0), avgR: rs.length ? stats.mean(rs) : 0,
      profitFactor: gl > 0 ? gw / gl : null, neededForVerdict: FORWARD_MIN_TRADES,
      // did signals inside event-pause windows do better or worse than the rest? (evidence for the pause rule)
      insidePause: { closed: closed.filter((r) => r.blackout).length, avgR: stats.mean(closed.filter((r) => r.blackout).map((r) => r.r)) },
      outsidePause: { closed: closed.filter((r) => !r.blackout).length, avgR: stats.mean(closed.filter((r) => !r.blackout).map((r) => r.r)) },
    };
  }

  recent(strategy, tf, n = 15) {
    return db.prepare(`SELECT signal_ts, direction, status, entry, exit_price, pnl, r, reason, exit_ts
      FROM journal WHERE strategy=? AND timeframe=? ORDER BY signal_ts DESC LIMIT ?`).all(strategy, tf, n);
  }
}

module.exports = Journal;
