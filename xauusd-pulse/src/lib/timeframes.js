// sec = bar length, interval = Twelve Data name, size = bars per request (the free-plan maximum),
// maxBars = most bars kept and analysed, pollMs = refresh interval for the newest bars.
// Free-plan budget: H1 every 10 min + H4 every 20 min is about 220 requests/day (limit: 800); loading older history is a one-off of roughly 15 requests.
module.exports = {
  H1: { sec: 3600, interval: '1h', size: 5000, maxBars: 60000, pollMs: 10 * 60 * 1000 },
  H4: { sec: 14400, interval: '4h', size: 5000, maxBars: 20000, pollMs: 20 * 60 * 1000 },
  D1: { sec: 86400, interval: '1day', size: 5000, maxBars: 5000, pollMs: 6 * 60 * 60 * 1000 },
};
