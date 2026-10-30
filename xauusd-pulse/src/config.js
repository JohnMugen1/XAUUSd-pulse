require('dotenv').config();

const env = (key, fallback) => {
  const v = process.env[key];
  return v !== undefined && v !== '' ? v : fallback;
};
const apiKey = env('TWELVEDATA_API_KEY', '');

module.exports = {
  port: Number(env('PORT', 3000)),
  host: env('HOST', '127.0.0.1'),
  dbPath: env('DB_PATH', 'data/xauusd.db'),

  // Live ticker
  priceSource: env('PRICE_SOURCE', 'binance').toLowerCase(),
  binanceWsUrl: env('BINANCE_WS_URL', 'wss://stream.binance.com:9443/ws/paxgusdt@ticker'),
  staleAfterMs: 15000,
  reconnect: { minMs: 1000, maxMs: 30000 },

  // Candles for signals and backtests. Uses real data when a key is set, else sample data.
  timeframes: env('TIMEFRAMES', 'H1,H4').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  candles: {
    source: env('CANDLE_SOURCE', apiKey ? 'twelvedata' : 'sample').toLowerCase(),
    apiKey,
    baseUrl: env('TWELVEDATA_BASE_URL', 'https://api.twelvedata.com'),
    symbol: 'XAU/USD',
    historyYears: Number(env('HISTORY_YEARS', 8)),
    pageDelayMs: Number(env('BACKFILL_PAGE_DELAY_MS', 8500)), // free plan allows 8 requests a minute
  },

  // News: 'rss' (live) or 'sample'
  news: {
    source: env('NEWS_SOURCE', 'rss').toLowerCase(),
    pollMs: Number(env('NEWS_POLL_MS', 120000)),
    feeds: env('NEWS_FEEDS', ''), // optional comma-separated list of RSS URLs (replaces the defaults)
    maxAgeHours: 72,
  },

  // Test lab scheduler: re-runs every strategy about once a day so verdicts stay current ('off' to disable)
  lab: {
    auto: env('LAB_AUTO', 'on').toLowerCase() !== 'off',
    delayMs: Number(env('LAB_AUTO_DELAY_MS', 20000)),
    everyMs: 6 * 60 * 60 * 1000,
  },

  // Pause signals around big US events (live safety filter; not part of the historical tests)
  pause: {
    enabled: env('EVENT_PAUSE', 'on').toLowerCase() !== 'off',
    beforeMin: Number(env('EVENT_PAUSE_BEFORE_MIN', 30)),
    afterMin: Number(env('EVENT_PAUSE_AFTER_MIN', 30)),
    impacts: env('EVENT_PAUSE_IMPACT', 'high').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean),
  },

  // Economic calendar: 'faireconomy' (live) or 'sample'
  calendar: {
    source: env('CALENDAR_SOURCE', 'faireconomy').toLowerCase(),
    url: env('CALENDAR_URL', 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'),
    nextUrl: env('CALENDAR_NEXT_URL', 'https://nfs.faireconomy.media/ff_calendar_nextweek.json'),
    pollMs: 12 * 60 * 60 * 1000,
  },
};
