// Checks stored candles for bars that cannot be real trading (flat bars, bars inside the weekend closure).
// Spot gold closes roughly Friday 22:00 UTC to Sunday 22:00 UTC.

function inWeekendClosure(tsSec) {
  const d = new Date(tsSec * 1000);
  const day = d.getUTCDay(), hour = d.getUTCHours();
  return day === 6 || (day === 5 && hour >= 22) || (day === 0 && hour < 22);
}

function analyze(candles) {
  const total = candles.length;
  let flat = 0, weekend = 0, weekendFlat = 0;
  for (const c of candles) {
    const isFlat = c.high === c.low;
    const isWeekend = inWeekendClosure(c.ts);
    if (isFlat) flat++;
    if (isWeekend) weekend++;
    if (isFlat && isWeekend) weekendFlat++;
  }
  return {
    bars: total, flatBars: flat, weekendBars: weekend, weekendFlatBars: weekendFlat,
    flatShare: total ? flat / total : 0, weekendShare: total ? weekend / total : 0,
  };
}

// Drop bars that should not exist: no price movement at all, or inside the weekend closure.
function clean(candles) {
  return candles.filter((c) => c.high > c.low && !inWeekendClosure(c.ts));
}

module.exports = { inWeekendClosure, analyze, clean };
