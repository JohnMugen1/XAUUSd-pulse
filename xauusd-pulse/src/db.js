const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS candles (
  timeframe TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  open REAL, high REAL, low REAL, close REAL,
  PRIMARY KEY (timeframe, ts)
);

CREATE TABLE IF NOT EXISTS news (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT UNIQUE NOT NULL,
  published_at INTEGER NOT NULL,
  fetched_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_published ON news(published_at DESC);

CREATE TABLE IF NOT EXISTS news_impact (
  news_id   INTEGER PRIMARY KEY REFERENCES news(id) ON DELETE CASCADE,
  gold_bias TEXT CHECK (gold_bias IN ('bullish','bearish','neutral')),
  usd_bias  TEXT CHECK (usd_bias  IN ('bullish','bearish','neutral')),
  score     REAL,
  usd_score REAL,
  reason    TEXT,
  method    TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  timeframe TEXT,
  strategy  TEXT,
  direction TEXT CHECK (direction IN ('buy','sell','hold')),
  entry REAL, stop_loss REAL, take_profit REAL,
  rsi REAL, ema_fast REAL, ema_slow REAL
);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id INTEGER PRIMARY KEY,
  run_at INTEGER, strategy TEXT, timeframe TEXT, params_json TEXT,
  bars INTEGER, profit_factor REAL, win_rate REAL,
  max_drawdown REAL, net_profit REAL
);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES backtest_runs(id) ON DELETE CASCADE,
  direction TEXT, entry_ts INTEGER, exit_ts INTEGER,
  entry REAL, exit REAL, pnl REAL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER, name TEXT, currency TEXT,
  impact TEXT,
  forecast TEXT, previous TEXT, actual TEXT
);
`);

// Upgrades for databases created by earlier versions.
const hasColumn = (table, col) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasColumn('news_impact', 'usd_score')) db.exec('ALTER TABLE news_impact ADD COLUMN usd_score REAL');

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_unique ON signals(timeframe, strategy, ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique ON events(ts, name, currency);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  strategy TEXT,
  timeframe TEXT,
  dedupe TEXT UNIQUE,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_ts ON notifications(ts DESC);

CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY,
  strategy TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  signal_ts INTEGER NOT NULL,
  direction TEXT NOT NULL,
  signal_close REAL,
  risk REAL,
  status TEXT NOT NULL,
  entry REAL, entry_ts INTEGER,
  exit_price REAL, exit_ts INTEGER,
  pnl REAL, r REAL, reason TEXT,
  created_at INTEGER NOT NULL,
  blackout INTEGER NOT NULL DEFAULT 0,
  UNIQUE (strategy, timeframe, signal_ts)
);
`);
if (!hasColumn('journal', 'blackout')) db.exec('ALTER TABLE journal ADD COLUMN blackout INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
db.getMeta = (k) => (db.prepare('SELECT value FROM meta WHERE key = ?').get(k) || {}).value;
db.setMeta = (k, v) =>
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

module.exports = db;
