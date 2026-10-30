const db = require('../db');
const bus = require('../bus');

const ins = db.prepare(`INSERT OR IGNORE INTO notifications (ts, level, kind, title, body, strategy, timeframe, dedupe)
  VALUES (?,?,?,?,?,?,?,?)`);

// On-site messages shown under the bell on the dashboard. A repeated `dedupe` key is stored only once.
const notifications = {
  add({ level = 'info', kind, title, body = '', strategy = null, timeframe = null, dedupe = null }) {
    const r = ins.run(Math.floor(Date.now() / 1000), level, kind, title, body, strategy, timeframe, dedupe);
    if (r.changes === 1) {
      db.prepare('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 300)').run();
      bus.notify('notifications');
      return true;
    }
    return false;
  },
  list(limit = 50) {
    return db.prepare('SELECT id, ts, level, kind, title, body, strategy, timeframe, read FROM notifications ORDER BY id DESC LIMIT ?').all(limit);
  },
  unread() {
    return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').get().n;
  },
  markAllRead() {
    db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
    bus.notify('notifications');
  },
};

module.exports = notifications;
