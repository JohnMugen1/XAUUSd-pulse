const EventEmitter = require('events');
const db = require('../db');
const TF = require('../lib/timeframes');
const sample = require('../lib/sampleCandles');

const upsert = db.prepare('INSERT OR REPLACE INTO candles (timeframe, ts, open, high, low, close) VALUES (?,?,?,?,?,?)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Twelve Data returns "2026-10-20 14:00:00" (UTC) for intraday and "2026-10-20" for daily bars.
function parseTime(dt) {
  const iso = dt.length === 10 ? `${dt}T00:00:00Z` : `${dt.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
function formatTime(tsSec, daily) {
  const iso = new Date(tsSec * 1000).toISOString(); // 2026-10-20T14:00:00.000Z
  return daily ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

class CandleService extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    let source = cfg.candles.source;
    if (source === 'twelvedata' && !cfg.candles.apiKey) {
      console.warn('[candles] CANDLE_SOURCE=twelvedata but no TWELVEDATA_API_KEY: using SAMPLE data');
      source = 'sample';
    }
    this.source = source;
    this.status = {};
    this.backfillState = {};
    this.timers = [];
    this.syncStoredSource();
  }

  // Fake (sample) and real candles must never be mixed: weekend gaps and prices would corrupt every signal.
  syncStoredSource() {
    const stored = db.getMeta('candle_source');
    const hasRows = !!db.prepare('SELECT 1 FROM candles LIMIT 1').get();
    if ((stored && stored !== this.source) || (!stored && hasRows)) {
      console.log(`[candles] data source is now "${this.source}": clearing stored candles, signals and backtests`);
      this.purgeAll();
    }
    db.setMeta('candle_source', this.source);
  }

  purgeAll() {
    db.transaction(() => {
      db.prepare('DELETE FROM candles').run();
      db.prepare('DELETE FROM signals').run();
      db.prepare('DELETE FROM backtest_runs').run(); // trades are removed with their run
      db.prepare('DELETE FROM journal').run();
      db.prepare("DELETE FROM meta WHERE key LIKE 'lab\\_%' ESCAPE '\\' OR key LIKE 'journal\\_start\\_%' ESCAPE '\\' OR key LIKE 'backfill\\_done\\_%' ESCAPE '\\'").run();
    })();
    this.backfillState = {};
  }

  // Check a key with one tiny request before it is saved.
  async testKey(key) {
    const url = new URL('/time_series', this.cfg.candles.baseUrl);
    url.search = new URLSearchParams({ symbol: this.cfg.candles.symbol, interval: '1h', outputsize: '2', timezone: 'UTC', apikey: key }).toString();
    let body;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      body = await res.json();
    } catch (err) {
      throw new Error('Could not reach Twelve Data to check the key. Check your internet connection and try again.');
    }
    if (body.status === 'error' || !Array.isArray(body.values)) {
      const msg = String(body.message || 'Twelve Data did not accept this key.').split(key).join('***');
      throw new Error('Twelve Data says: ' + msg);
    }
  }

  // Switch from sample to real candles without a restart.
  useKey(key) {
    const wasSample = this.source !== 'twelvedata';
    this.cfg.candles.apiKey = key;
    this.source = 'twelvedata';
    if (wasSample) this.purgeAll();
    db.setMeta('candle_source', 'twelvedata');
    this.status = {};
    this.emit('sourceChanged');
    for (const tf of this.cfg.timeframes) if (TF[tf]) this.refresh(tf).then(() => this.backfill(tf));
  }

  start() {
    if (this.source === 'sample') console.log('[candles] SAMPLE candles in use (fake data). Add TWELVEDATA_API_KEY to .env for real data.');
    for (const tf of this.cfg.timeframes) {
      if (!TF[tf]) { console.warn(`[candles] unknown timeframe ${tf}, skipped`); continue; }
      this.refresh(tf).then(() => this.backfill(tf));
      const t = setInterval(() => this.refresh(tf), TF[tf].pollMs);
      t.unref();
      this.timers.push(t);
    }
  }

  stop() { this.timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); }

  historyInfo(tf) {
    const r = db.prepare('SELECT MIN(ts) AS a, MAX(ts) AS b, COUNT(*) AS n FROM candles WHERE timeframe = ?').get(tf);
    return { from: r.a, to: r.b, bars: r.n, years: r.n ? (r.b - r.a) / (365.25 * 86400) : 0, backfill: this.backfillState[tf] || { status: this.source === 'sample' ? 'n/a' : 'waiting' } };
  }

  async refresh(tf) {
    try {
      const bars = this.source === 'sample'
        ? sample.generate(tf, Math.floor(Date.now() / 1000), TF[tf].maxBars, sample.DEEP_START, 4100)
        : await this.fetchTwelveData(tf);
      this.store(tf, bars);
      this.status[tf] = { ok: true, at: Date.now(), error: null };
      this.emit('refreshed', tf);
    } catch (err) {
      this.status[tf] = { ok: false, at: Date.now(), error: err.message };
      console.warn(`[candles] ${tf} refresh failed: ${err.message}`);
    }
  }

  // endTs: when given, fetch the page of bars that ends at that time (used to load older history).
  async fetchTwelveData(tf, endTs) {
    const { baseUrl, apiKey, symbol } = this.cfg.candles;
    const url = new URL('/time_series', baseUrl);
    const q = { symbol, interval: TF[tf].interval, outputsize: String(TF[tf].size), timezone: 'UTC', order: 'ASC', apikey: apiKey };
    if (endTs) q.end_date = formatTime(endTs, TF[tf].interval === '1day');
    url.search = new URLSearchParams(q).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    let body;
    try { body = await res.json(); } catch { throw new Error(`Twelve Data returned HTTP ${res.status} with no JSON`); }
    if (body.status === 'error' || !Array.isArray(body.values)) {
      throw new Error(`Twelve Data: ${String(body.message || 'unexpected response').split(apiKey).join('***')}`);
    }
    return body.values
      .map((v) => ({ ts: parseTime(v.datetime), open: +v.open, high: +v.high, low: +v.low, close: +v.close }))
      .filter((b) => b.ts && [b.open, b.high, b.low, b.close].every(Number.isFinite))
      .sort((a, b) => a.ts - b.ts);
  }

  // One-off: walk backwards in pages of 5000 bars until the configured number of years is loaded, the provider
  // has nothing older, or a request fails (then it pauses and retries in an hour). Paced to stay inside the free limit.
  async backfill(tf) {
    if (this.source !== 'twelvedata') return;
    const cur = this.backfillState[tf];
    if (cur && cur.status === 'running') return;
    if (db.getMeta(`backfill_done_${tf}`) === 'done') { this.backfillState[tf] = { status: 'done', pages: 0 }; return; }
    const state = { status: 'running', pages: 0, error: null };
    this.backfillState[tf] = state;
    const target = Math.floor(Date.now() / 1000) - this.cfg.candles.historyYears * 365.25 * 86400;
    try {
      for (let page = 0; page < 40; page++) {
        const earliest = db.prepare('SELECT MIN(ts) AS m FROM candles WHERE timeframe = ?').get(tf).m;
        if (earliest == null || earliest <= target) break;
        const older = (await this.fetchTwelveData(tf, earliest)).filter((b) => b.ts < earliest);
        if (!older.length) break; // the provider has nothing older
        this.store(tf, older, false);
        state.pages++;
        await sleep(this.cfg.candles.pageDelayMs);
      }
      state.status = 'done';
      db.setMeta(`backfill_done_${tf}`, 'done');
      this.emit('backfilled', tf);
    } catch (err) {
      state.status = 'paused'; state.error = err.message;
      console.warn(`[candles] ${tf} history loading paused: ${err.message} (retrying in an hour)`);
      if (state.pages > 0) this.emit('backfilled', tf);
      const t = setTimeout(() => this.backfill(tf), 60 * 60 * 1000);
      t.unref(); this.timers.push(t);
    }
  }

  store(tf, bars, prune = true) {
    db.transaction(() => {
      for (const b of bars) upsert.run(tf, b.ts, b.open, b.high, b.low, b.close);
      if (prune) {
        const cutoff = Math.floor(Date.now() / 1000) - (this.cfg.candles.historyYears + 1) * 365.25 * 86400;
        db.prepare('DELETE FROM candles WHERE timeframe = ? AND ts < ?').run(tf, cutoff);
      }
    })();
  }
}

module.exports = CandleService;
