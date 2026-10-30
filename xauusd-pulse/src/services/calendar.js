const db = require('../db');
const bus = require('../bus');

const upsert = db.prepare(`INSERT INTO events (ts, name, currency, impact, forecast, previous, actual)
  VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(ts, name, currency) DO UPDATE SET
    impact = excluded.impact, forecast = excluded.forecast, previous = excluded.previous, actual = excluded.actual`);

class CalendarService {
  constructor(cfg) {
    this.cfg = cfg;
    this.source = cfg.calendar.source;
    this.status = { ok: null, at: null, error: null, count: 0 };
    this.timer = null;
    const stored = db.getMeta('calendar_source');
    if (stored !== this.source) {
      const hasRows = !!db.prepare('SELECT 1 FROM events LIMIT 1').get();
      if (hasRows) db.prepare('DELETE FROM events').run();
      db.setMeta('calendar_source', this.source);
    }
  }

  start() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.cfg.calendar.pollMs);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); }

  async refresh() {
    try {
      const events = this.source === 'sample' ? this.sampleEvents() : await this.fetchLive();
      if (this.source === 'sample') db.prepare('DELETE FROM events').run();
      db.transaction(() => {
        for (const e of events) upsert.run(e.ts, e.name, e.currency, e.impact, e.forecast, e.previous, e.actual);
      })();
      this.status = { ok: true, at: Date.now(), error: null, count: events.length };
      bus.notify('events');
    } catch (err) {
      this.status = { ...this.status, ok: false, at: Date.now(), error: err.message };
      console.warn(`[calendar] refresh failed: ${err.message}`);
    }
  }

  async fetchOne(url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (XAUUSD personal dashboard)' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('unexpected calendar format');
    return data;
  }

  // US events that move gold. This week is required; next week only exists later in the week, so it is optional.
  async fetchLive() {
    const rows = await this.fetchOne(this.cfg.calendar.url);
    try { rows.push(...(await this.fetchOne(this.cfg.calendar.nextUrl))); } catch { /* not published yet */ }
    return rows
      .filter((r) => r.country === 'USD' && /^(high|medium)$/i.test(r.impact || ''))
      .map((r) => ({
        ts: Math.floor(Date.parse(r.date) / 1000),
        name: String(r.title || '').trim(),
        currency: 'USD',
        impact: String(r.impact).toLowerCase(),
        forecast: r.forecast || '', previous: r.previous || '', actual: r.actual || '',
      }))
      .filter((e) => Number.isFinite(e.ts) && e.name);
  }

  sampleEvents() {
    const now = Math.floor(Date.now() / 1000);
    const h = 3600;
    return [
      { off: 3 * h, name: 'Core CPI m/m', impact: 'high', f: '0.3%', p: '0.3%' },
      { off: 20 * h, name: 'Unemployment Claims', impact: 'medium', f: '225K', p: '221K' },
      { off: 30 * h, name: 'Non-Farm Employment Change', impact: 'high', f: '150K', p: '142K' },
      { off: 52 * h, name: 'FOMC Statement', impact: 'high', f: '', p: '' },
      { off: 76 * h, name: 'ISM Services PMI', impact: 'medium', f: '52.1', p: '51.6' },
    ].map((e) => ({ ts: now + e.off, name: e.name, currency: 'USD', impact: e.impact, forecast: e.f, previous: e.p, actual: '' }));
  }
}

module.exports = CalendarService;
