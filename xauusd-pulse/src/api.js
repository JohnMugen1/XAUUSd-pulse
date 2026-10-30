const fs = require('fs');
const path = require('path');
const express = require('express');
const { upsertEnvLine } = require('./lib/envFile');
const pkg = require('../package.json');
const db = require('./db');
const TF = require('./lib/timeframes');
const backtest = require('./services/backtest');
const strategies = require('./strategy');
const { simulate } = require('./strategy/engine');
const notifications = require('./services/notifications');
const eventPause = require('./services/eventPause');
const { toCsv } = require('./lib/csv');
const { computeSentiment } = require('./lib/sentiment');

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const HIGH = 0.6; // |score| at or above this is flagged as high-impact news

module.exports = function buildRouter({ price, candles, analysis, news, calendar, lab, journal, config, clients }) {
  const r = express.Router();
  const tfOf = (q) => {
    const tf = String(q || config.timeframes[0] || 'H1').toUpperCase();
    return TF[tf] ? tf : null;
  };

  const stratOf = (q) => strategies.get(String(q || strategies.DEFAULT_NAME));
  const localOnly = (req) => {
    const host = req.headers.host || '';
    const origin = req.headers.origin;
    return LOCAL_HOST.test(host) && (!origin || origin === `http://${host}`);
  };

  r.get('/health', (req, res) =>
    res.json({
      ok: true,
      priceSource: config.priceSource,
      priceStatus: price.status,
      lastTickAgeMs: price.lastTickAt ? Date.now() - price.lastTickAt : null,
      clients: clients.size,
      uptimeSec: Math.round(process.uptime()),
    }));

  r.get('/price', (req, res) => res.json({ status: price.status, tick: price.lastTick }));

  r.get('/status', (req, res) =>
    res.json({
      now: Date.now(),
      version: pkg.version,
      keySet: Boolean(config.candles.apiKey),
      price: { source: config.priceSource, status: price.status },
      candles: { source: candles.source, configured: config.timeframes,
        timeframes: Object.fromEntries(config.timeframes.map((tf) => [tf, { ...(candles.status[tf] || {}), history: candles.historyInfo(tf) }])) },
      news: { source: news.source, lastPollAt: news.lastPollAt, feeds: news.feedStatus },
      calendar: { source: calendar.source, ...calendar.status },
      analysisErrors: analysis.errors,
    }));

  // Lets you paste the Twelve Data key on the page instead of editing files. Local use only.
  r.post('/settings/twelvedata-key', express.json({ limit: '2kb' }), async (req, res) => {
    const host = req.headers.host || '';
    const origin = req.headers.origin;
    if (!LOCAL_HOST.test(host) || (origin && origin !== `http://${host}`)) {
      return res.status(403).json({ error: 'Not allowed from here.' });
    }
    const key = String((req.body && req.body.key) || '').trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
      return res.status(400).json({ error: 'That does not look like a Twelve Data key. Paste only the key: letters and numbers, no spaces.' });
    }
    try { await candles.testKey(key); } catch (err) { return res.status(400).json({ error: err.message }); }

    let saved = true;
    try {
      const envPath = path.join(process.cwd(), '.env');
      const examplePath = path.join(process.cwd(), '.env.example');
      const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8')
        : fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : '';
      fs.writeFileSync(envPath, upsertEnvLine(current, 'TWELVEDATA_API_KEY', key), 'utf8');
    } catch { saved = false; } // still works for this session, just will not survive a restart
    candles.useKey(key);
    analysis.reset();
    setTimeout(() => lab.autoRun(), 30000).unref();
    res.json({ ok: true, saved });
  });

  r.get('/strategies', (req, res) =>
    res.json(strategies.list.map((st) => ({
      name: st.NAME, label: st.LABEL, description: st.DESCRIPTION, rule: st.RULE, selectedOnSeenData: !!st.selectedOnSeenData,
      timeframes: Object.fromEntries(config.timeframes.map((tf) => [tf, { lab: lab.verdictInfo(st.NAME, tf), live: journal.summary(st.NAME, tf) }])),
    }))));

  r.get('/signal', (req, res) => {
    const tf = tfOf(req.query.tf), st = stratOf(req.query.strategy);
    if (!tf || !st) return res.status(400).json({ error: 'unknown timeframe or strategy' });
    res.json({ ...analysis.getSignal(tf, st.NAME), pause: eventPause.now() });
  });

  r.get('/performance', (req, res) => {
    const tf = tfOf(req.query.tf), st = stratOf(req.query.strategy);
    if (!tf || !st) return res.status(400).json({ error: 'unknown timeframe or strategy' });
    res.json(backtest.getPerformance(tf, st.NAME));
  });

  r.get('/journal', (req, res) => {
    const tf = tfOf(req.query.tf), st = stratOf(req.query.strategy);
    if (!tf || !st) return res.status(400).json({ error: 'unknown timeframe or strategy' });
    res.json({ summary: journal.summary(st.NAME, tf), recent: journal.recent(st.NAME, tf) });
  });

  r.get('/pause', (req, res) => res.json(eventPause.now()));

  // CSV downloads for a spreadsheet (journal of live signals, and the backtest's trade list)
  const sendCsv = (res, name, text) => {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });
    res.send(text);
  };
  const iso = (t) => (t == null ? '' : new Date(t * 1000).toISOString());
  r.get('/export/journal.csv', (req, res) => {
    const tf = tfOf(req.query.tf), st = stratOf(req.query.strategy);
    if (!tf || !st) return res.status(400).json({ error: 'unknown timeframe or strategy' });
    const rows = db.prepare('SELECT * FROM journal WHERE strategy = ? AND timeframe = ? ORDER BY signal_ts').all(st.NAME, tf).map((x) => ({
      signal_time: iso(x.signal_ts), direction: x.direction, status: x.status, entry_time: iso(x.entry_ts), entry: x.entry,
      exit_time: iso(x.exit_ts), exit_price: x.exit_price, pnl_points: x.pnl, r_multiple: x.r, reason: x.reason, inside_event_pause: x.blackout ? 'yes' : 'no',
    }));
    sendCsv(res, `journal_${st.NAME}_${tf}.csv`, toCsv(['signal_time', 'direction', 'status', 'entry_time', 'entry', 'exit_time', 'exit_price', 'pnl_points', 'r_multiple', 'reason', 'inside_event_pause'], rows));
  });
  r.get('/export/trades.csv', (req, res) => {
    const tf = tfOf(req.query.tf), st = stratOf(req.query.strategy);
    if (!tf || !st) return res.status(400).json({ error: 'unknown timeframe or strategy' });
    const run = db.prepare('SELECT id FROM backtest_runs WHERE strategy = ? AND timeframe = ?').get(st.NAME, tf);
    const rows = run ? db.prepare('SELECT * FROM backtest_trades WHERE run_id = ? ORDER BY entry_ts').all(run.id).map((x) => ({
      entry_time: iso(x.entry_ts), exit_time: iso(x.exit_ts), direction: x.direction, entry: x.entry, exit: x.exit, pnl_points: x.pnl,
    })) : [];
    sendCsv(res, `backtest_trades_${st.NAME}_${tf}.csv`, toCsv(['entry_time', 'exit_time', 'direction', 'entry', 'exit', 'pnl_points'], rows));
  });

  r.get('/notifications', (req, res) => res.json({ unread: notifications.unread(), items: notifications.list(50) }));
  r.post('/notifications/read', (req, res) => {
    if (!localOnly(req)) return res.status(403).json({ error: 'Not allowed from here.' });
    notifications.markAllRead();
    res.json({ ok: true });
  });

  // Data-quality and signal check: shows what the stored candles look like and how many signals/trades they produce.
  r.get('/debug/backtest', (req, res) => {
    const tf = tfOf(req.query.tf), st = stratOf(req.query.strategy);
    if (!tf || !st) return res.status(400).json({ error: 'unknown timeframe or strategy' });
    const sec = TF[tf].sec;
    const now = Math.floor(Date.now() / 1000);
    const iso = (t) => new Date(t * 1000).toISOString();
    const rows = db.prepare('SELECT ts, open, high, low, close FROM candles WHERE timeframe = ? ORDER BY ts ASC').all(tf);
    const closed = rows.filter((x) => x.ts + sec <= now);
    const invalid = rows.filter((x) => ![x.open, x.high, x.low, x.close].every(Number.isFinite) || x.high < x.low || x.close <= 0).length;
    const gaps = [];
    for (let i = 1; i < closed.length; i++) gaps.push(closed[i].ts - closed[i - 1].ts);
    const sorted = [...gaps].sort((a, b) => a - b);
    const out = {
      timeframe: tf, dataSource: candles.source, barSeconds: sec,
      candles: {
        stored: rows.length, closed: closed.length, invalid,
        first: closed.length ? iso(closed[0].ts) : null,
        last: closed.length ? iso(closed[closed.length - 1].ts) : null,
        spacing: { medianSeconds: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
          maxSeconds: sorted.length ? sorted[sorted.length - 1] : null,
          gapsBiggerThan3Bars: gaps.filter((g) => g > 3 * sec).length },
        lowestClose: closed.length ? Math.min(...closed.map((x) => x.close)) : null,
        highestClose: closed.length ? Math.max(...closed.map((x) => x.close)) : null,
      },
    };
    if (closed.length >= 80) {
      const win = closed.slice(-TF[tf].maxBars);
      const { signals, ind } = st.compute(win);
      const hits = signals.map((s, i) => ({ i, s })).filter((x) => x.s.dir !== 'hold');
      const sim = simulate(win, {}, st);
      const last = win.length - 1;
      out.indicators = st.describe(ind, last, st.DEFAULTS);
      out.signals = {
        total: hits.length,
        buy: hits.filter((x) => x.s.dir === 'buy').length,
        sell: hits.filter((x) => x.s.dir === 'sell').length,
        recent: hits.slice(-6).map((x) => ({ closedAt: iso(win[x.i].ts + sec), dir: x.s.dir, entry: x.s.entry })),
      };
      out.freshSimulation = { trades: sim.trades.length, metrics: sim.metrics, lastTrades: sim.trades.slice(-3) };
    }
    const stored = backtest.getPerformance(tf, st.NAME);
    out.storedResult = { status: stored.status, window: stored.window, metrics: stored.metrics };
    res.json(out);
  });

  // Test lab: heavy analysis, queued on demand and polled until done. Starting a run is local use only.
  r.get('/lab', (req, res) => {
    const tf = tfOf(req.query.tf), st = stratOf(req.query.strategy);
    if (!tf || !st) return res.status(400).json({ error: 'unknown timeframe or strategy' });
    res.json(lab.get(tf, st.NAME));
  });
  r.get('/lab/summary', (req, res) => {
    const tf = tfOf(req.query.tf);
    if (!tf) return res.status(400).json({ error: 'unknown timeframe' });
    res.json(lab.summary(tf));
  });
  r.post('/lab/run', (req, res) => {
    if (!localOnly(req)) return res.status(403).json({ error: 'Not allowed from here.' });
    const tf = tfOf(req.query.tf);
    if (!tf) return res.status(400).json({ error: 'unknown timeframe' });
    if (String(req.query.strategy) === 'all') return res.json({ started: lab.startAll(tf), summary: lab.summary(tf) });
    const st = stratOf(req.query.strategy);
    if (!st) return res.status(400).json({ error: 'unknown strategy' });
    res.json({ started: lab.start(tf, st.NAME), ...lab.get(tf, st.NAME) });
  });

  r.get('/news', (req, res) => {
    const filter = String(req.query.filter || 'all');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 100);
    const since = Math.floor(Date.now() / 1000) - config.news.maxAgeHours * 3600;
    const where = {
      all: '',
      gold: "AND i.gold_bias IS NOT NULL AND i.gold_bias != 'neutral'",
      usd: "AND i.usd_bias IS NOT NULL AND i.usd_bias != 'neutral'",
      high: `AND (ABS(COALESCE(i.score,0)) >= ${HIGH} OR ABS(COALESCE(i.usd_score,0)) >= ${HIGH})`,
    }[filter] ?? '';
    const rows = db.prepare(`
      SELECT n.id, n.source, n.title, n.url, n.published_at, i.gold_bias, i.usd_bias, i.score, i.usd_score, i.reason, i.method
      FROM news n LEFT JOIN news_impact i ON i.news_id = n.id
      WHERE n.published_at >= ? ${where}
      ORDER BY n.published_at DESC LIMIT ?`).all(since, limit);
    res.json({
      source: news.source,
      items: rows.map((n) => ({
        id: n.id, source: n.source, title: n.title,
        url: /^https?:\/\/[^ ]+$/i.test(n.url) && !n.url.includes('.invalid') ? n.url : null,
        publishedAt: n.published_at,
        goldBias: n.gold_bias || 'neutral', usdBias: n.usd_bias || 'neutral',
        goldScore: n.score || 0, usdScore: n.usd_score || 0,
        reason: n.reason || '', method: n.method || 'rules',
        high: Math.abs(n.score || 0) >= HIGH || Math.abs(n.usd_score || 0) >= HIGH,
      })),
    });
  });

  r.get('/sentiment', (req, res) => {
    const now = Math.floor(Date.now() / 1000);
    const rows = db.prepare(`SELECT n.published_at, i.score, i.usd_score FROM news n
      JOIN news_impact i ON i.news_id = n.id WHERE n.published_at >= ?`).all(now - 24 * 3600);
    res.json({ ...computeSentiment(rows, now), source: news.source });
  });

  r.get('/events', (req, res) => {
    const now = Math.floor(Date.now() / 1000);
    const rows = db.prepare(`SELECT ts, name, currency, impact, forecast, previous, actual FROM events
      WHERE ts >= ? ORDER BY ts ASC LIMIT 15`).all(now - 3600);
    res.json({ source: calendar.source, items: rows });
  });

  return r;
};
