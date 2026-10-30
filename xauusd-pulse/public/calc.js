// Position-size maths, kept separate so it can be tested. 1 standard gold lot is usually 100 oz,
// so a 1.00 move in price is about $100 per lot; check your broker's contract size.
(function (root) {
  function calcLots({ balance, riskPct, stopPoints, ozPerLot = 100, minLot = 0.01 }) {
    const riskUsd = (balance * riskPct) / 100;
    const perLot = stopPoints * ozPerLot; // dollars lost per 1.00 lot if the stop is hit
    if (!(balance > 0) || !(riskPct > 0) || !(stopPoints > 0) || !(ozPerLot > 0)) return { valid: false };
    const raw = riskUsd / perLot;
    const lots = Math.floor(raw / minLot + 1e-9) * minLot;
    const minLotRisk = minLot * perLot;
    return {
      valid: true, riskUsd, perLot, raw,
      lots: Math.round(lots * 100) / 100,
      actualRisk: lots * perLot,
      belowMinimum: lots < minLot,
      minLotRisk, minLotRiskPct: (minLotRisk / balance) * 100,
    };
  }
  const api = { calcLots };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
