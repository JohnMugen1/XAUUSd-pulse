const test = require('node:test');
const assert = require('node:assert');
process.env.DB_PATH = ':memory:';
const db = require('../src/db');
const notifications = require('../src/services/notifications');
const Journal = require('../src/services/journal');
const strategies = require('../src/strategy');
const { simulate } = require('../src/strategy/engine');
const { evaluate, CONFIRM_AFTER_SECONDS } = require('../src/lab/status');
const sample = require('../src/lib/sampleCandles');

const result = (label, ranAt, passed = 6, extra = {}) => ({
  ranAt, strategy: { name: 'x' }, verdict: { label, passed, total: 7, note: 'note' }, ...extra,
});

test('a first pass is only a candidate; a second pass 12+ hours later is "good to go"; staying good is silent', () => {
  const T = 1_800_000_000, H = 3600;
  const a = evaluate(null, result('Promising', T), 'Strat', 'H4');
  assert.strictEqual(a.notice.kind, 'candidate');
  assert.deepStrictEqual(a.confirm, { firstPromisingAt: T, confirmed: false });
  const r1 = result('Promising', T, 6, { confirm: a.confirm });
  const tooSoon = evaluate(r1, result('Promising', T + 5 * H), 'Strat', 'H4');
  assert.strictEqual(tooSoon.notice, null);
  assert.strictEqual(tooSoon.confirm.confirmed, false);
  const b = evaluate(r1, result('Promising', T + 13 * H), 'Strat', 'H4');
  assert.strictEqual(b.notice.kind, 'good_to_go');
  assert.strictEqual(b.notice.level, 'success');
  assert.ok(b.confirm.confirmed && b.confirm.firstPromisingAt === T);
  const r2 = result('Promising', T + 13 * H, 6, { confirm: b.confirm });
  assert.strictEqual(evaluate(r2, result('Promising', T + 30 * H), 'Strat', 'H4').notice, null);
  assert.ok(CONFIRM_AFTER_SECONDS === 12 * H);
});
test('falling from Promising warns; first result and label changes inform; an unchanged label is silent', () => {
  const T = 1_800_000_000;
  const prev = result('Promising', T, 6, { confirm: { firstPromisingAt: T, confirmed: true } });
  const drop = evaluate(prev, result('Mixed', T + 86400, 5), 'Strat', 'H1');
  assert.strictEqual(drop.notice.kind, 'lab_dropped'); assert.strictEqual(drop.notice.level, 'warning');
  assert.strictEqual(evaluate(null, result('Not proven', T, 2), 'Strat', 'H1').notice.kind, 'lab_result');
  assert.strictEqual(evaluate(result('Not proven', T, 2), result('Not proven', T + 86400, 2), 'Strat', 'H1').notice, null);
  assert.strictEqual(evaluate(result('Not proven', T, 2), result('Mixed', T + 86400, 4), 'Strat', 'H1').notice.kind, 'lab_result');
});

test('notifications: duplicates are stored once, unread counts, and mark-all-read works', () => {
  const base = notifications.unread();
  assert.strictEqual(notifications.add({ kind: 'k', title: 'Hello', dedupe: 'd1' }), true);
  assert.strictEqual(notifications.add({ kind: 'k', title: 'Hello again', dedupe: 'd1' }), false);
  assert.strictEqual(notifications.add({ kind: 'k', title: 'Other', dedupe: 'd2', level: 'success' }), true);
  assert.strictEqual(notifications.unread(), base + 2);
  assert.strictEqual(notifications.list(10)[0].title, 'Other');
  notifications.markAllRead();
  assert.strictEqual(notifications.unread(), 0);
  assert.ok(notifications.list(10).every((n) => n.read === 1));
});

test('journal: records only signals after it started, follows them to the same outcome as the backtest, and never duplicates', () => {
  const now = 1792654000;
  const closed = sample.generate('H1', now, 4000).slice(0, -1);
  const sec = 3600;
  const start = closed[2500].ts + sec;
  const added = [];
  const fakeNotes = { add: (n) => { added.push(n); return true; } };
  const journal = new Journal({ notifications: fakeNotes, labVerdict: (name) => (name === 'rsi_ema' ? 'Promising' : 'Not proven') });
  db.setMeta('journal_start_rsi_ema_H1', String(start));
  const nowSec = closed[closed.length - 1].ts + sec;
  journal.update('H1', closed, nowSec);

  const rows = db.prepare("SELECT * FROM journal WHERE strategy='rsi_ema' AND timeframe='H1' ORDER BY signal_ts").all();
  assert.ok(rows.length >= 5, 'expected several live signals, got ' + rows.length);
  assert.ok(rows.every((r) => r.signal_ts > start), 'no back-filled signals');
  const countAfter = rows.length;
  journal.update('H1', closed, nowSec); // running again must not duplicate anything
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM journal WHERE strategy='rsi_ema' AND timeframe='H1'").get().n, countAfter);

  // identical outcomes to the backtest engine once both are following the same trades
  const st = strategies.get('rsi_ema');
  const sim = simulate(closed, {}, st).trades;
  const done = rows.filter((r) => r.status === 'closed');
  assert.ok(done.length >= 3);
  const firstShared = done.findIndex((r) => sim.some((t) => t.entry_ts === r.entry_ts && t.direction === r.direction));
  assert.ok(firstShared >= 0, 'journal and backtest share at least one trade');
  const simTail = sim.filter((t) => t.entry_ts >= done[firstShared].entry_ts && t.exit_ts <= closed[closed.length - 1].ts);
  done.slice(firstShared).forEach((r, i) => {
    assert.strictEqual(r.entry_ts, simTail[i].entry_ts);
    assert.strictEqual(r.direction, simTail[i].direction);
    assert.ok(Math.abs(r.pnl - simTail[i].pnl) < 1e-9);
    assert.ok(Math.abs(r.r - simTail[i].r) < 1e-9);
  });

  // skipped signals really did arrive while another trade was running
  for (const r of rows.filter((x) => x.status === 'skipped')) {
    const prev = rows.filter((x) => x.status !== 'skipped' && x.signal_ts < r.signal_ts).pop();
    assert.ok(prev && (prev.status !== 'closed' || prev.exit_ts > r.signal_ts - sec), 'skipped signal must overlap an earlier trade');
  }
  // alerts only for the strategy that currently passes the lab, and never for old signals
  assert.ok(added.every((n) => n.strategy === 'rsi_ema' && n.kind === 'signal'));
  assert.ok(added.every((n) => n.body.includes('not financial advice')));
  const s = journal.summary('rsi_ema', 'H1');
  assert.strictEqual(s.closed, done.length);
  assert.strictEqual(s.signals, rows.length);
});

test('lab service: sample-data results never count for alerts, and version 1.3 results are found', () => {
  const LabService = require('../src/services/labService');
  const real = new LabService({ source: 'twelvedata' }, { notifications, config: { timeframes: ['H1'], lab: { auto: false } } });
  const fake = new LabService({ source: 'sample' }, { notifications, config: { timeframes: ['H1'], lab: { auto: false } } });
  const mk = (dataSource) => ({ ranAt: 1, dataSource, verdict: { label: 'Promising', passed: 6, total: 7 }, baseline: { avgR: 0.1, trades: 50 } });
  db.setMeta('lab_breakout_H1', JSON.stringify(mk('twelvedata')));
  assert.strictEqual(real.verdictLabel('breakout', 'H1'), 'Promising');
  assert.strictEqual(fake.verdictLabel('breakout', 'H1'), null, 'sample candles must not allow alerts');
  db.setMeta('lab_bounce_H1', JSON.stringify(mk('sample')));
  assert.strictEqual(real.verdictLabel('bounce', 'H1'), null, 'a result computed on sample data must not allow alerts');
  db.setMeta('lab_H1', JSON.stringify(mk('twelvedata'))); // old key written by version 1.3
  assert.strictEqual(real.stored('rsi_ema', 'H1').verdict.label, 'Promising');
  assert.strictEqual(real.stored('pullback_v2', 'H1'), null, 'old results belong to the first strategy only');
});

test('switching data source clears everything derived from the old candles', () => {
  db.prepare("INSERT INTO journal (strategy, timeframe, signal_ts, direction, status, created_at) VALUES ('x','H1',1,'buy','closed',1)").run();
  db.setMeta('journal_start_x_H1', '5');
  db.setMeta('lab_x_H1', '{}');
  const CandleService = require('../src/services/candles');
  const svc = new CandleService({ timeframes: ['H1'], candles: { source: 'sample', apiKey: '', baseUrl: 'http://x', symbol: 'XAU/USD' } });
  svc.purgeAll();
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM journal').get().n, 0);
  assert.strictEqual(db.getMeta('journal_start_x_H1'), undefined);
  assert.strictEqual(db.getMeta('lab_x_H1'), undefined);
  assert.strictEqual(db.getMeta('lab_breakout_H1'), undefined);
});

test('lab summary keeps the strategy name and the verdict in separate fields', () => {
  const LabService = require('../src/services/labService');
  const svc = new LabService({ source: 'twelvedata' }, { notifications, config: { timeframes: ['H1'], lab: { auto: false } } });
  db.setMeta('lab_breakout_H1', JSON.stringify({ ranAt: 1, dataSource: 'twelvedata', verdict: { label: 'Mixed', passed: 4, total: 7 }, baseline: { avgR: 0.05, trades: 40 } }));
  const row = svc.summary('H1').find((x) => x.name === 'breakout');
  assert.strictEqual(row.label, 'Breakout');
  assert.strictEqual(row.verdict, 'Mixed');
  assert.strictEqual(row.passed, 4);
});
