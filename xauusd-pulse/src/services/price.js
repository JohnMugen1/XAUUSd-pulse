const EventEmitter = require('events');
const WebSocket = require('ws');

/**
 * Holds ONE connection to the live price source and re-broadcasts ticks.
 * Events:  'tick'   -> { price, change, changePct, high, low, ts, source }
 *          'status' -> 'connecting' | 'live' | 'reconnecting' | 'stopped'
 */
class PriceService extends EventEmitter {
  constructor(config) {
    super();
    this.cfg = config;
    this.lastTick = null;
    this.lastTickAt = null;
    this.status = 'connecting';
    this.ws = null;
    this.retryMs = config.reconnect.minMs;
    this.retryTimer = null;
    this.watchdog = null;
    this.mockTimer = null;
    this.stopped = false;
  }

  start() {
    if (this.cfg.priceSource === 'mock') return this.startMock();
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.watchdog);
    clearInterval(this.mockTimer);
    if (this.ws) this.ws.terminate();
    this.setStatus('stopped');
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  publish(tick) {
    this.lastTick = tick;
    this.lastTickAt = Date.now();
    this.emit('tick', tick);
  }

  // ---- live source: Binance public WebSocket, PAXG/USDT 24h ticker (no API key) ----
  connect() {
    if (this.stopped) return;
    this.setStatus(this.lastTick ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(this.cfg.binanceWsUrl);
    this.ws = ws;

    ws.on('open', () => {
      console.log('[price] connected to Binance');
      this.lastTickAt = Date.now();
      clearInterval(this.watchdog);
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastTickAt > this.cfg.staleAfterMs) {
          console.warn('[price] no ticks, reopening connection');
          ws.terminate();
        }
      }, 5000);
    });

    ws.on('message', (raw) => {
      let d;
      try { d = JSON.parse(raw); } catch { return; }
      const price = Number(d.c);
      if (!Number.isFinite(price)) return;
      this.retryMs = this.cfg.reconnect.minMs; // healthy again: reset backoff
      this.setStatus('live');
      this.publish({
        price,
        change: Number(d.p),
        changePct: Number(d.P),
        high: Number(d.h),
        low: Number(d.l),
        ts: Number(d.E) || Date.now(),
        source: 'PAXG via Binance',
      });
    });

    ws.on('error', (err) => console.warn('[price] socket error:', err.message));

    ws.on('close', () => {
      clearInterval(this.watchdog);
      if (this.stopped) return;
      this.setStatus('reconnecting');
      console.log(`[price] disconnected, retrying in ${this.retryMs} ms`);
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, this.cfg.reconnect.maxMs);
    });
  }

  // ---- offline test source ----
  startMock() {
    console.log('[price] MOCK mode: ticks are fake, for offline testing only');
    const open = 4100;
    let price = open;
    let high = open, low = open;
    this.setStatus('live');
    this.mockTimer = setInterval(() => {
      price = Math.max(1, price + (Math.random() - 0.5) * 1.2);
      high = Math.max(high, price);
      low = Math.min(low, price);
      this.publish({
        price: +price.toFixed(2),
        change: +(price - open).toFixed(2),
        changePct: +(((price - open) / open) * 100).toFixed(3),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        ts: Date.now(),
        source: 'MOCK (fake data)',
      });
    }, 1000);
  }
}

module.exports = PriceService;
