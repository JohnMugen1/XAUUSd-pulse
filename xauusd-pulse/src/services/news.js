const Parser = require('rss-parser');
const db = require('../db');
const bus = require('../bus');
const { analyze } = require('../lib/impact');

const parser = new Parser();
const google = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:1d')}&hl=en-US&gl=US&ceid=US:en`;

// Google News searches are already on-topic. Other feeds are general, so they are keyword-filtered.
const DEFAULT_FEEDS = [
  { name: 'Google News: gold', url: google('gold price OR XAUUSD'), google: true, filter: false },
  { name: 'Google News: Fed', url: google('Federal Reserve interest rates'), google: true, filter: false },
  { name: 'Google News: dollar and yields', url: google('US dollar index Treasury yields'), google: true, filter: false },
  { name: 'Google News: inflation and jobs', url: google('US inflation CPI jobs report'), google: true, filter: false },
  { name: 'Google News: safe haven', url: google('gold safe haven geopolitical'), google: true, filter: false },
  { name: 'FXStreet', url: 'https://www.fxstreet.com/rss/news', filter: true },
  { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', filter: true },
];

const KEYWORDS = /\b(gold|xau|xauusd|bullion|dollar|usd|dxy|greenback|fed|fomc|federal reserve|powell|treasury|yields?|inflation|cpi|pce|ppi|payrolls?|nfp|jobs|unemployment|rate (?:cuts?|hikes?|decision)|interest rates?|safe[- ]haven|central banks?|geopolit\w*|tariffs?)\b/i;
const isRelevant = (title) => KEYWORDS.test(title);

const SAMPLE_HEADLINES = [
  'Gold climbs as dollar slips ahead of Fed decision',
  'Treasury yields rise as US jobs report beats expectations',
  'Fed officials signal rate cuts could be delayed as inflation proves sticky',
  'Dollar index falls to two-week low on weak retail sales data',
  'Safe-haven demand lifts gold amid rising geopolitical tensions',
  'Gold slides as profit-taking follows record high',
  'Central banks continue buying gold, survey shows',
  'US inflation cools in latest CPI reading, rate-cut hopes grow',
  'Strong US dollar weighs on commodities as yields climb',
  'Gold ETF outflows accelerate as investors rotate to stocks',
  'Ceasefire talks progress, easing safe-haven bids',
  'Fed holds rates steady, Powell sounds dovish on outlook',
  'Oil steadies as traders await US data',
];

const insNews = db.prepare('INSERT OR IGNORE INTO news (source, title, url, published_at, fetched_at) VALUES (?,?,?,?,?)');
const insImpact = db.prepare(`INSERT OR REPLACE INTO news_impact
  (news_id, gold_bias, usd_bias, score, usd_score, reason, method) VALUES (?,?,?,?,?,?,?)`);
const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

class NewsService {
  constructor(cfg) {
    this.cfg = cfg;
    this.source = cfg.news.source;
    this.feeds = this.buildFeeds();
    this.feedStatus = [];
    this.lastPollAt = null;
    this.timer = null;
    this.sampleIdx = 0;
    if (this.source !== 'sample') db.prepare("DELETE FROM news WHERE source = 'Sample feed'").run();
    this.seen = new Set(
      db.prepare('SELECT title FROM news WHERE published_at > ?').all(Math.floor(Date.now() / 1000) - 3 * 86400)
        .map((r) => normTitle(r.title))
    );
  }

  buildFeeds() {
    const custom = this.cfg.news.feeds.split(',').map((s) => s.trim()).filter(Boolean);
    if (!custom.length) return DEFAULT_FEEDS;
    return custom.map((url) => ({ name: new URL(url).hostname, url, filter: true }));
  }

  start() {
    this.poll();
    this.timer = setInterval(() => this.poll(), this.cfg.news.pollMs);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); }

  store(item, allowDuplicateTitle = false) {
    const key = normTitle(item.title);
    if (!allowDuplicateTitle && this.seen.has(key)) return false;
    const now = Math.floor(Date.now() / 1000);
    const r = insNews.run(item.source, item.title, item.url, item.published, now);
    if (r.changes !== 1) return false;
    this.seen.add(key);
    const a = analyze(item.title);
    insImpact.run(r.lastInsertRowid, a.goldBias, a.usdBias, a.goldScore, a.usdScore, a.reason, a.method);
    return true;
  }

  async poll() {
    let added = 0;
    if (this.source === 'sample') {
      added = this.pollSample();
    } else {
      const results = await Promise.allSettled(this.feeds.map((f) => this.fetchFeed(f)));
      this.feedStatus = results.map((r, i) => {
        const f = this.feeds[i];
        if (r.status === 'rejected') {
          console.warn(`[news] ${f.name}: ${r.reason.message}`);
          return { name: f.name, ok: false, items: 0, added: 0, error: r.reason.message, at: Date.now() };
        }
        let n = 0;
        db.transaction(() => { for (const it of r.value) if (this.store(it)) n++; })();
        added += n;
        return { name: f.name, ok: true, items: r.value.length, added: n, error: null, at: Date.now() };
      });
    }
    this.lastPollAt = Date.now();
    db.prepare('DELETE FROM news WHERE published_at < ?').run(Math.floor(Date.now() / 1000) - 7 * 86400);
    if (added > 0) { bus.notify('news'); bus.notify('sentiment'); }
  }

  pollSample() {
    const now = Math.floor(Date.now() / 1000);
    let added = 0;
    if (this.sampleIdx === 0) { // first run: fill the feed with headlines spread over the last hours
      SAMPLE_HEADLINES.forEach((title, i) => {
        const url = `https://example.invalid/sample/${i}-${now}`;
        if (this.store({ source: 'Sample feed', title, url, published: now - (i + 1) * 1500 }, true)) added++;
      });
      this.sampleIdx = SAMPLE_HEADLINES.length;
    } else { // later runs: one new headline each time so the live feed visibly moves
      const title = SAMPLE_HEADLINES[this.sampleIdx % SAMPLE_HEADLINES.length];
      this.sampleIdx++;
      if (this.store({ source: 'Sample feed', title, url: `https://example.invalid/sample/n${this.sampleIdx}-${now}`, published: now }, true)) added++;
    }
    return added;
  }

  async fetchFeed(feed) {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (XAUUSD personal dashboard)', Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = await parser.parseString(await res.text());
    const now = Math.floor(Date.now() / 1000);
    const maxAge = this.cfg.news.maxAgeHours * 3600;
    const out = [];
    for (const it of parsed.items || []) {
      let title = String(it.title || '').replace(/\s+/g, ' ').trim();
      const url = String(it.link || '').trim();
      if (!title || !/^https?:\/\//i.test(url)) continue;
      let source = feed.name;
      if (feed.google) { // Google titles look like "Headline - Publisher"
        const cut = title.lastIndexOf(' - ');
        if (cut > 0) { source = title.slice(cut + 3).trim() || source; title = title.slice(0, cut).trim(); }
      }
      if (feed.filter && !isRelevant(title)) continue;
      let published = Math.floor(Date.parse(it.isoDate || it.pubDate || '') / 1000);
      if (!Number.isFinite(published)) published = now;
      published = Math.min(published, now);
      if (now - published > maxAge) continue;
      out.push({ source, title, url, published });
    }
    return out;
  }
}

module.exports = NewsService;
module.exports.isRelevant = isRelevant;
