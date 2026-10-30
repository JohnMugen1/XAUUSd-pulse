const path = require('path');
const express = require('express');
const config = require('./config');
const bus = require('./bus');
require('./db'); // creates the database and tables on first run
const PriceService = require('./services/price');
const CandleService = require('./services/candles');
const Analysis = require('./services/analysis');
const Journal = require('./services/journal');
const notifications = require('./services/notifications');
const eventPause = require('./services/eventPause');
const NewsService = require('./services/news');
const CalendarService = require('./services/calendar');
const LabService = require('./services/labService');
const buildRouter = require('./api');
const fs = require('fs');
const pkg = require('../package.json');

const app = express();
const price = new PriceService(config);
const candles = new CandleService(config);
const news = new NewsService(config);
const calendar = new CalendarService(config);
const lab = new LabService(candles, { notifications, config });
const journal = new Journal({ notifications, labVerdict: (name, tf) => lab.verdictLabel(name, tf), pauseAt: (ts) => eventPause.windowAround(ts) });
const analysis = new Analysis(candles, journal);
const clients = new Set();

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', buildRouter({ price, candles, analysis, news, calendar, lab, journal, config, clients }));

const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

// Server-Sent Events: one stream for everything that is pushed live.
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  send(res, 'status', price.status);
  if (price.lastTick) send(res, 'tick', price.lastTick);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

setInterval(() => clients.forEach((res) => res.write(': ping\n\n')), 15000).unref();
price.on('tick', (t) => clients.forEach((res) => send(res, 'tick', t)));
price.on('status', (s) => clients.forEach((res) => send(res, 'status', s)));
bus.on('update', (u) => clients.forEach((res) => send(res, 'update', u)));

// When older history has been loaded, recompute every backtest and re-run the lab on the longer data.
candles.on('backfilled', (tf) => {
  try { analysis.invalidate(tf); analysis.run(tf); lab.startAll(tf); } catch (err) { console.error('[history] follow-up failed:', err); }
});

// Whenever new candles arrive, recompute the signal and (on a new closed bar) the backtest.
candles.on('refreshed', (tf) => {
  try { analysis.run(tf); } catch (err) { console.error(`[analysis] ${tf} failed:`, err); }
});

const server = app.listen(config.port, config.host, () => {
  const envPath = path.join(process.cwd(), '.env');
  console.log(`XAUUSD platform v${pkg.version} running at http://${config.host}:${config.port}`);
  console.log(`  .env: ${fs.existsSync(envPath) ? 'found' : 'NOT FOUND'} in ${process.cwd()} | Twelve Data key: ${config.candles.apiKey ? 'set' : 'not set'}`);
  console.log(`  price: ${config.priceSource} | candles: ${candles.source} | news: ${news.source} | calendar: ${calendar.source}`);
  price.start();
  for (const tf of config.timeframes) { // show last known results immediately, before the first refresh finishes
    try { analysis.run(tf); } catch { /* no stored candles yet */ }
  }
  candles.start();
  news.start();
  calendar.start();
  lab.startScheduler();
});

function shutdown() {
  console.log('Shutting down...');
  price.stop(); candles.stop(); news.stop(); calendar.stop(); lab.stopScheduler();
  clients.forEach((res) => res.end());
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
