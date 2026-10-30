// Rule-based news impact. Reads a headline and estimates its likely effect on gold and the US dollar.
// It is a transparent heuristic, not a forecast: it only sees the headline text.

const UP = 'rises?|rose|jumps?|jumped|surges?|surged|climbs?|climbed|gains?|gained|rallies|rallied|rally|advances?|strengthens?|firms?|edges (?:up|higher)|trades higher|moves higher|extends gains|steadies near highs';
const DOWN = 'falls?|fell|drops?|dropped|slips?|slipped|slides?|slid|declines?|declined|sinks?|sank|tumbles?|tumbled|retreats?|slumps?|weakens?|loses|edges (?:down|lower)|trades lower|moves lower|extends losses';

const GOLD = '(?:gold|xau(?:/?usd)?|bullion)(?:\\s+(?:prices?|futures|spot|rates?))?\\s+(?:(?:is|are|has|have)\\s+)?';
const DXY = '(?:(?:us|u\\.s\\.)\\s+)?(?:dollar(?:\\s+index)?|greenback|dxy)\\s+(?:(?:is|are|has|have)\\s+)?';

const R = (src) => new RegExp(src, 'i');

const RULES = [
  // ----- dollar and yields -----
  { id: 'usd_up', re: R(`\\b${DXY}(?:${UP}|hits? (?:a )?(?:\\w+-?\\w*\\s)?high)\\b|\\b(?:stronger|firmer|strong|higher)\\s+(?:us\\s+)?(?:dollar|greenback)\\b`),
    usd: 0.8, gold: -0.6, why: 'A stronger dollar makes gold costlier for foreign buyers.' },
  { id: 'usd_down', re: R(`\\b${DXY}(?:${DOWN}|hits? (?:a )?(?:\\w+-?\\w*\\s)?low)\\b|\\b(?:weaker|softer|weak|lower)\\s+(?:us\\s+)?(?:dollar|greenback)\\b`),
    usd: -0.8, gold: 0.6, why: 'A weaker dollar makes gold cheaper for foreign buyers.' },
  { id: 'yield_up', re: R(`\\byields?\\s+(?:${UP}|higher)\\b|\\b(?:higher|rising|climbing|surging)\\s+(?:(?:treasury|bond|us)\\s+)?yields?\\b`),
    usd: 0.6, gold: -0.7, why: 'Higher Treasury yields raise the cost of holding gold, which pays no interest.' },
  { id: 'yield_down', re: R(`\\byields?\\s+(?:${DOWN}|lower)\\b|\\b(?:lower|falling|declining|dropping|slumping)\\s+(?:(?:treasury|bond|us)\\s+)?yields?\\b`),
    usd: -0.6, gold: 0.7, why: 'Falling yields lower the cost of holding gold.' },

  // ----- Fed and rates -----
  { id: 'hawkish', re: R('\\b(?:rate hikes?|raises? rates|hikes? rates|hawkish|higher for longer|no rate cuts?|rate cuts?(?:\\s+\\w+){0,3}\\s+(?:delayed|pushed back|unlikely|off the table)|delays? (?:rate )?cuts?|fewer (?:rate )?cuts)\\b'),
    usd: 0.7, gold: -0.7, why: 'Hawkish Fed expectations support the dollar and weigh on gold.' },
  { id: 'dovish', re: R('\\b(?<!no\\s)(?<!not\\s)(?:rate cuts?(?!(?:\\s+\\w+){0,3}\\s+(?:delayed|pushed|unlikely|off))|cuts? rates|dovish|rate[- ]cut (?:bets|hopes|expectations)|easing cycle|policy easing|pivot)\\b'),
    usd: -0.7, gold: 0.7, why: 'Rate-cut expectations weaken the dollar and support gold.' },

  // ----- US data -----
  { id: 'data_strong', re: R('\\b(?:jobs|payrolls?|nfp|employment|retail sales|gdp|ism|pmi|consumer spending)\\b[^.]{0,30}\\b(?:beats?|tops?|surges?|jumps?|strong(?:er)?|robust|hot|hotter|exceeds?|above (?:forecasts?|expectations))\\b|\\b(?:strong(?:er)?|robust|hot|hotter|solid|blowout)\\s+(?:us\\s+)?(?:jobs|payrolls?|nfp|employment|retail sales|gdp|labou?r|data)\\b'),
    usd: 0.5, gold: -0.5, why: 'Strong US data lowers the odds of rate cuts, a headwind for gold.' },
  { id: 'data_weak', re: R('\\b(?:jobs|payrolls?|nfp|employment|retail sales|gdp|ism|pmi|consumer spending)\\b[^.]{0,30}\\b(?:miss(?:es)?|missed|weak(?:er)?|soft(?:er)?|slows?|slowed|slowdown|disappoint\\w*|contracts?|below (?:forecasts?|expectations))\\b|\\b(?:weak(?:er)?|soft(?:er)?|disappointing)\\s+(?:us\\s+)?(?:jobs|payrolls?|nfp|employment|retail sales|gdp|labou?r|data)\\b'),
    usd: -0.5, gold: 0.5, why: 'Weak US data raises the odds of rate cuts, supportive for gold.' },
  { id: 'unemp_up', re: R('\\bunemployment(?: rate)?\\s+(?:rises?|jumps?|climbs?|higher|ticks up)\\b'),
    usd: -0.4, gold: 0.4, why: 'Rising unemployment raises the odds of rate cuts.' },
  { id: 'infl_hot', re: R('\\b(?:inflation|cpi|pce|ppi)\\b[^.]{0,30}\\b(?:hotter|higher than expected|accelerat\\w+|stays? (?:high|elevated)|sticky|above (?:forecasts?|expectations)|rises?|jumps?)\\b'),
    usd: 0.4, gold: -0.3, why: 'Hotter inflation can keep the Fed restrictive, pressuring gold in the short term.' },
  { id: 'infl_cool', re: R('\\b(?:inflation|cpi|pce|ppi)\\b[^.]{0,30}\\b(?:cools?|cooled|cooling|eases?|eased|easing|slows?|slowed|softer|below (?:forecasts?|expectations)|falls?|fell|lower than expected)\\b'),
    usd: -0.5, gold: 0.5, why: 'Cooling inflation supports rate-cut hopes, which helps gold.' },

  // ----- gold itself and demand -----
  { id: 'gold_up', re: R(`\\b${GOLD}(?:${UP}|hits? (?:a )?(?:record|all-time|fresh|new)\\b[^.]{0,12}high)\\b`),
    usd: 0, gold: 0.7, why: 'The headline reports gold moving higher.' },
  { id: 'gold_down', re: R(`\\b${GOLD}(?:${DOWN})\\b`),
    usd: 0, gold: -0.7, why: 'The headline reports gold moving lower.' },
  { id: 'haven', re: R('\\b(?:safe[- ]haven (?:demand|buying|bid|flows?|appeal)|flight to safety|haven demand)\\b'),
    usd: 0.1, gold: 0.6, why: 'Safe-haven demand tends to lift gold.' },
  { id: 'geo', re: R('\\b(?:war|attacks?|missiles?|escalat\\w+|tensions?|conflict|invasion|sanctions)\\b'),
    usd: 0, gold: 0.35, why: 'Geopolitical tension tends to raise safe-haven demand for gold.' },
  { id: 'peace', re: R('\\b(?:ceasefire|peace (?:deal|talks|agreement)|de-?escalat\\w+|truce)\\b'),
    usd: 0, gold: -0.3, why: 'Easing tensions reduce safe-haven demand.' },
  { id: 'cb_buy', re: R('\\bcentral banks?\\b[^.]{0,25}\\b(?:buy|buying|bought|purchas\\w+|accumulat\\w+|adds?)\\b'),
    usd: 0, gold: 0.5, why: 'Central-bank buying supports gold demand.' },
  { id: 'etf_in', re: R('\\betf\\b[^.]{0,20}\\b(?:inflows?|demand|holdings (?:rise|climb|increase))\\b'),
    usd: 0, gold: 0.4, why: 'Rising ETF holdings point to investor demand for gold.' },
  { id: 'etf_out', re: R('\\betf\\b[^.]{0,20}\\b(?:outflows?|selling|redemptions|holdings (?:fall|drop|decline))\\b'),
    usd: 0, gold: -0.4, why: 'ETF outflows point to investors selling gold.' },
  { id: 'profit', re: R('\\bprofit[- ]taking\\b'),
    usd: 0, gold: -0.3, why: 'Profit-taking can cap or reverse gold rallies.' },
  { id: 'recession', re: R('\\b(?:recession|slowdown|downturn)\\s+(?:fears|worries|risks?|concerns)\\b'),
    usd: 0, gold: 0.3, why: 'Growth fears tend to support gold as a defensive asset.' },
];

const BIAS_THRESHOLD = 0.25;
const bias = (x) => (x > BIAS_THRESHOLD ? 'bullish' : x < -BIAS_THRESHOLD ? 'bearish' : 'neutral');

function analyze(title) {
  const text = String(title || '');
  const hits = RULES.filter((r) => r.re.test(text));
  const goldSum = hits.reduce((s, r) => s + r.gold, 0);
  const usdSum = hits.reduce((s, r) => s + r.usd, 0);
  const goldScore = Math.tanh(goldSum);
  const usdScore = Math.tanh(usdSum);
  const reasons = [...hits]
    .sort((a, b) => Math.abs(b.gold) + Math.abs(b.usd) - (Math.abs(a.gold) + Math.abs(a.usd)))
    .slice(0, 2)
    .map((r) => r.why);
  return {
    goldBias: bias(goldScore),
    usdBias: bias(usdScore),
    goldScore: Math.round(goldScore * 1000) / 1000,
    usdScore: Math.round(usdScore * 1000) / 1000,
    reason: reasons.length ? reasons.join(' ') : 'No clear driver for gold or the dollar in this headline.',
    method: 'rules',
  };
}

module.exports = { analyze, RULES, BIAS_THRESHOLD };
