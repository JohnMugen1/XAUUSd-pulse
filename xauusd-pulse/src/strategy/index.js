const list = [
  require('./rsiEma'),
  require('./pullbackV2'),
  require('./breakout'),
  require('./bounce'),
];
const byName = Object.fromEntries(list.map((s) => [s.NAME, s]));
module.exports = { list, get: (name) => byName[name] || null, DEFAULT_NAME: 'rsi_ema' };
