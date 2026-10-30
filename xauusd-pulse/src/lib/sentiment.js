// Recency-weighted sentiment from analysed headlines.
// Newer headlines count more (half-life about 5.5 hours); few headlines are shrunk toward neutral.
const HALF_LIFE_H = 8; // exp(-age/8h)

function gauge(rows, nowSec, field) {
  let wSum = 0, wScore = 0, count = 0;
  for (const r of rows) {
    const s = r[field];
    if (s == null || Math.abs(s) < 0.01) continue; // headlines with no driver carry no signal
    const ageH = Math.max(0, (nowSec - r.published_at) / 3600);
    const w = Math.exp(-ageH / HALF_LIFE_H);
    wSum += w;
    wScore += w * s;
    count++;
  }
  const raw = wSum > 0 ? wScore / wSum : 0;
  const score = raw * (wSum / (wSum + 3)); // shrinkage: three fresh headlines for half confidence
  const label = score > 0.2 ? 'Bullish' : score < -0.2 ? 'Bearish' : 'Neutral';
  return { score: Math.round(score * 1000) / 1000, label, count };
}

function computeSentiment(rows, nowSec = Math.floor(Date.now() / 1000)) {
  return {
    gold: gauge(rows, nowSec, 'score'),
    usd: gauge(rows, nowSec, 'usd_score'),
    windowHours: 24,
    updatedAt: nowSec,
  };
}

module.exports = { computeSentiment };
