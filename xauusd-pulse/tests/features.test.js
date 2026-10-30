const test = require('node:test');
const assert = require('node:assert');
process.env.DB_PATH = ':memory:';
const db = require('../src/db');
const config = require('../src/config');
const eventPause = require('../src/services/eventPause');
const Journal = require('../src/services/journal');
const { toCsv, esc } = require('../src/lib/csv');
const { calcLots } = require('../public/calc.js');
const sample = require('../src/lib/sampleCandles');

const addEvent = (ts, name, impact = 'high') => db.prepare("INSERT INTO events (ts, name, currency, impact, forecast, previous, actual) VALUES (?,?,?,?,?,?,?)").run(ts, name, 'USD', impact, '', '', '');

test('event pause: active from 30 minutes before to 30 minutes after a high-impact event, not outside, not for low impact', () => {
  config.pause.enabled = true; config.pause.beforeMin = 30; config.pause.afterMin = 30; config.pause.impacts = ['high'];
  const T = 1_900_000_000;
  addEvent(T, 'CPI m/m');
  addEvent(T + 100000, 'Retail Sales', 'medium');
  assert.strictEqual(eventPause.windowAround(T - 31 * 60), null);
  assert.strictEqual(eventPause.windowAround(T - 29 * 60).name, 'CPI m/m');
  assert.strictEqual(eventPause.windowAround(T + 29 * 60).name, 'CPI m/m');
  assert.strictEqual(eventPause.windowAround(T + 31 * 60), null);
  assert.strictEqual(eventPause.windowAround(T + 100000), null, 'medium impact does not pause by default');
  const n = eventPause.now(T - 10 * 60);
  assert.ok(n.active && n.event.resumesAt === T + 30 * 60 && n.next.name === 'CPI m/m');
  config.pause.impacts = ['high', 'medium'];
  assert.strictEqual(eventPause.windowAround(T + 100000).name, 'Retail Sales');
  config.pause.enabled = false;
  assert.strictEqual(eventPause.windowAround(T), null, 'can be switched off');
  config.pause.enabled = true; config.pause.impacts = ['high'];
});

test('journal: a signal inside an event window is flagged, alerts say it is on hold, and the stats separate it', () => {
  const closed = sample.generate('H1', 1792654000, 4000).slice(0, -1);
  const sec = 3600;
  const added = [];
  db.setMeta('journal_start_rsi_ema_H1', String(closed[3000].ts + sec));
  const journal = new Journal({
    notifications: { add: (n) => { added.push(n); return true; } },
    labVerdict: () => 'Promising',
    pauseAt: (ts) => (ts % 2 === 0 ? { name: 'FOMC Statement', ts, resumesAt: ts + 1800 } : null),
  });
  journal.update('H1', closed, closed[closed.length - 1].ts + sec);
  const rows = db.prepare("SELECT * FROM journal WHERE strategy='rsi_ema' AND timeframe='H1'").all();
  assert.ok(rows.length >= 3);
  rows.forEach((r) => assert.strictEqual(r.blackout, r.signal_ts % 2 === 0 ? 1 : 0));
  assert.ok(added.every((n) => n.kind === 'signal' || n.kind === 'signal_paused'));
  assert.ok(added.filter((n) => n.kind === 'signal_paused').every((n) => /on hold/.test(n.title) && /FOMC Statement/.test(n.body) && /not financial advice/.test(n.body)));
  const s = journal.summary('rsi_ema', 'H1');
  assert.strictEqual(s.insidePause.closed + s.outsidePause.closed, s.closed);
});

test('csv: fields with commas, quotes and line breaks are quoted; nulls are empty', () => {
  assert.strictEqual(esc('a,b'), '"a,b"');
  assert.strictEqual(esc('say "hi"'), '"say ""hi"""');
  assert.strictEqual(esc(null), '');
  assert.strictEqual(toCsv(['a', 'b'], [{ a: 1, b: 'x,y' }, { a: null, b: 2 }]), 'a,b\r\n1,"x,y"\r\n,2\r\n');
});

test('position size: lots from balance, risk and stop; warns when even the smallest lot is too big', () => {
  const ok = calcLots({ balance: 10000, riskPct: 1, stopPoints: 25 });
  assert.strictEqual(ok.riskUsd, 100); assert.strictEqual(ok.perLot, 2500);
  assert.strictEqual(ok.lots, 0.04); assert.strictEqual(ok.belowMinimum, false);
  assert.ok(ok.actualRisk <= ok.riskUsd + 1e-9, 'never risks more than asked when rounding down');
  const small = calcLots({ balance: 1000, riskPct: 1, stopPoints: 20 });
  assert.ok(small.belowMinimum);
  assert.strictEqual(small.minLotRisk, 20); assert.strictEqual(small.minLotRiskPct, 2);
  assert.strictEqual(calcLots({ balance: 0, riskPct: 1, stopPoints: 20 }).valid, false);
  assert.strictEqual(calcLots({ balance: 1000, riskPct: 1, stopPoints: 0 }).valid, false);
  // rounds DOWN to the lot step, never up
  const r = calcLots({ balance: 1000, riskPct: 1, stopPoints: 3.3 });
  assert.ok(r.lots * r.perLot <= r.riskUsd + 1e-9);
});
