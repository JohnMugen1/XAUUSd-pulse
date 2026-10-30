const db = require('../db');
const bus = require('../bus');
const TF = require('../lib/timeframes');
const strategies = require('../strategy');
const { runLab } = require('../lab/lab');
const { evaluate } = require('../lab/status');

const DAY = 24 * 3600;

// Runs the test lab in the background, one job at a time (it yields often, so the live price keeps flowing),
// remembers every result, and posts on-site messages when a strategy's verdict changes.
class LabService {
  constructor(candleService, { notifications, config }) {
    this.candles = candleService;
    this.notifications = notifications;
    this.config = config;
    this.jobs = {};
    this.chain = Promise.resolve();
  }

  loadCandles(tf) {
    const sec = TF[tf].sec, now = Math.floor(Date.now() / 1000);
    return db.prepare('SELECT ts, open, high, low, close FROM candles WHERE timeframe = ? ORDER BY ts DESC LIMIT ?')
      .all(tf, TF[tf].maxBars).reverse()
      .filter((r) => r.ts + sec <= now);
  }

  stored(name, tf) {
    // results saved by version 1.3 used a key without the strategy name; they belong to the first strategy
    const raw = db.getMeta(`lab_${name}_${tf}`) || (name === strategies.DEFAULT_NAME ? db.getMeta(`lab_${tf}`) : null);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  // Used to decide whether live signals may raise alerts. Results computed on SAMPLE (fake) data never count.
  verdictLabel(name, tf) {
    const r = this.stored(name, tf);
    return r && r.dataSource !== 'sample' && this.candles.source !== 'sample' ? r.verdict.label : null;
  }

  verdictInfo(name, tf) {
    const job = this.jobs[`${name}:${tf}`];
    const r = this.stored(name, tf);
    const running = !!job && (job.status === 'running' || job.status === 'queued');
    if (!r) return { label: null, running };
    return { label: r.verdict.label, passed: r.verdict.passed, total: r.verdict.total, ranAt: r.ranAt,
      confirmed: !!(r.confirm && r.confirm.confirmed), avgR: r.baseline.avgR, trades: r.baseline.trades, running };
  }

  get(tf, name) {
    const job = this.jobs[`${name}:${tf}`];
    const stored = this.stored(name, tf);
    if (job && (job.status === 'running' || job.status === 'queued' || job.status === 'error')) {
      return { status: job.status === 'queued' ? 'running' : job.status, progress: job.progress, error: job.error || null, result: stored };
    }
    return { status: stored ? 'done' : 'idle', progress: null, error: null, result: stored };
  }

  summary(tf) {
    return strategies.list.map((st) => {
      const v = this.verdictInfo(st.NAME, tf);
      return { name: st.NAME, label: st.LABEL, selectedOnSeenData: !!st.selectedOnSeenData,
        verdict: v.label, passed: v.passed, total: v.total, ranAt: v.ranAt, confirmed: v.confirmed, avgR: v.avgR, trades: v.trades, running: v.running };
    });
  }

  // Queue one run. Returns false if that strategy/timeframe is already queued or running.
  start(tf, name) {
    const key = `${name}:${tf}`;
    const st = strategies.get(name);
    if (!st) return false;
    if (this.jobs[key] && (this.jobs[key].status === 'running' || this.jobs[key].status === 'queued')) return false;
    const job = { status: 'queued', progress: { step: 'Waiting', pct: 0 } };
    this.jobs[key] = job;
    this.chain = this.chain.then(() => this.execute(st, tf, job));
    return true;
  }

  startAll(tf) {
    return strategies.list.map((st) => this.start(tf, st.NAME)).some(Boolean);
  }

  async execute(st, tf, job) {
    job.status = 'running';
    job.progress = { step: 'Starting', pct: 0 };
    bus.notify('lab');
    try {
      const result = await runLab(this.loadCandles(tf), {
        strategy: st, dataSource: this.candles.source, onProgress: (p) => { job.progress = p; },
      });
      const stored = this.stored(st.NAME, tf);
      // never compare real results with fake ones, nor a result on much shorter history (a pass on 2 years does not confirm a pass on 8)
      const prev = stored && stored.dataSource === result.dataSource && result.window.bars <= stored.window.bars * 1.5 ? stored : null;
      const ev = evaluate(prev, result, st.LABEL, tf);
      result.confirm = ev.confirm;
      db.setMeta(`lab_${st.NAME}_${tf}`, JSON.stringify(result));
      if (ev.notice && result.dataSource !== 'sample') this.notifications.add({ ...ev.notice, strategy: st.NAME, timeframe: tf });
      job.status = 'done';
    } catch (err) {
      job.status = 'error'; job.error = err.message;
      console.error(`[lab] ${st.NAME} ${tf} failed:`, err.message);
    }
    bus.notify('lab');
  }

  // Re-run anything that has never run or is older than a day, so verdicts stay current and can be confirmed.
  autoRun() {
    const now = Math.floor(Date.now() / 1000);
    for (const tf of this.config.timeframes) {
      if (!TF[tf] || this.loadCandles(tf).length < 400) continue;
      for (const st of strategies.list) {
        const r = this.stored(st.NAME, tf);
        if (!r || r.dataSource !== this.candles.source || now - r.ranAt > DAY) this.start(tf, st.NAME);
      }
    }
  }

  startScheduler() {
    if (!this.config.lab.auto) return;
    const first = setTimeout(() => this.autoRun(), this.config.lab.delayMs);
    const every = setInterval(() => this.autoRun(), this.config.lab.everyMs);
    first.unref(); every.unref();
    this.timers = [first, every];
  }

  stopScheduler() { (this.timers || []).forEach((t) => { clearTimeout(t); clearInterval(t); }); }
}

module.exports = LabService;
