// Pauses signals around big US events (CPI, NFP, FOMC...). A live safety filter only: the calendar has no
// history, so the backtests and the lab do NOT include this rule. The journal records which trades fell inside a pause
// window, so over time we can see whether staying out would have helped.
const db = require('../db');
const config = require('../config');

const impacts = () => config.pause.impacts;

// The event (if any) whose pause window contains the given moment.
function windowAround(refSec) {
  if (!config.pause.enabled) return null;
  const before = config.pause.beforeMin * 60, after = config.pause.afterMin * 60;
  const rows = db.prepare('SELECT ts, name, impact FROM events WHERE ts BETWEEN ? AND ? ORDER BY ts')
    .all(refSec - after, refSec + before).filter((r) => impacts().includes(r.impact));
  if (!rows.length) return null;
  const e = rows[0];
  return { name: e.name, impact: e.impact, ts: e.ts, startsAt: e.ts - before, resumesAt: e.ts + after };
}

function now(refSec = Math.floor(Date.now() / 1000)) {
  const w = windowAround(refSec);
  const next = db.prepare('SELECT ts, name, impact FROM events WHERE ts > ? ORDER BY ts').all(refSec).find((r) => impacts().includes(r.impact)) || null;
  return { enabled: config.pause.enabled, active: !!w, event: w, next, beforeMin: config.pause.beforeMin, afterMin: config.pause.afterMin };
}

module.exports = { windowAround, now };
