(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };
  const getJSON = async (path) => {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };
  const num = (n, d = 2) => (n == null || !Number.isFinite(+n) ? '--' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sgn = (n) => (n > 0 ? '+' : '');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const when = (sec) => new Date(sec * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const whenY = (sec) => new Date(sec * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const whenYT = (sec) => new Date(sec * 1000).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const ago = (sec) => {
    const m = Math.max(0, Math.round((Date.now() / 1000 - sec) / 60));
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const hrs = Math.floor(m / 60);
    return hrs < 24 ? hrs + ' h ago' : Math.floor(hrs / 24) + ' d ago';
  };
  const inTime = (sec) => {
    const m = Math.round((sec - Date.now() / 1000) / 60);
    if (m <= 0) return 'now';
    if (m < 60) return 'in ' + m + ' min';
    const hrs = Math.floor(m / 60);
    return hrs < 48 ? `in ${hrs} h ${m % 60} min` : 'in ' + Math.floor(hrs / 24) + ' d';
  };
  const chip = (text, cls) => h('span', 'chip ' + cls, text);
  const sampleChip = () => chip('SAMPLE DATA', 'sample');

  // ------------------------------------------------------------------ live ticker
  const el = { status: $('status'), statusText: $('status-text'), price: $('price'), change: $('change'),
    high: $('high'), low: $('low'), source: $('source'), updated: $('updated') };
  const STALE_MS = 15000;
  let lastPrice = null, lastTickAt = 0, serverStatus = 'connecting';

  const setStatus = (s) => { el.status.className = 'status ' + s; el.statusText.textContent = s === 'live' ? 'LIVE' : s.toUpperCase(); };

  function onTick(t) {
    lastTickAt = Date.now();
    el.price.textContent = num(t.price);
    if (lastPrice !== null && t.price !== lastPrice) {
      el.price.className = 'price ' + (t.price > lastPrice ? 'up' : 'down');
      void el.price.offsetWidth; el.price.classList.add('flash'); // retrigger the pop animation on every move
    }
    lastPrice = t.price;
    el.change.className = 'change ' + (t.change > 0 ? 'up' : t.change < 0 ? 'down' : '');
    el.change.textContent = `${sgn(t.change)}${num(t.change)} (${sgn(t.changePct)}${num(t.changePct)}%)`;
    el.high.textContent = num(t.high);
    el.low.textContent = num(t.low);
    el.source.textContent = t.source;
    el.updated.textContent = 'Updated ' + new Date(t.ts).toLocaleTimeString();
    if (serverStatus === 'live') setStatus('live');
  }

  // ------------------------------------------------------------------ tabs helper
  function tabs(container, options, current, onPick) {
    container.replaceChildren();
    options.forEach(([value, label]) => {
      const b = h('button', 'tab' + (value === current ? ' active' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => onPick(value));
      container.appendChild(b);
    });
  }

  const state = { tfs: ['H1', 'H4'], sigTf: 'H1', perfTf: 'H1', newsFilter: 'all', news: [], newsSource: '', strategy: 'rsi_ema', strategies: [] };
  const labClass = (l) => (l === 'Promising' ? 'bullish' : l === 'Mixed' ? 'neutral' : l ? 'bearish' : 'neutral');
  const labStatus = (tf) => { const cur = state.strategies.find((x) => x.name === state.strategy); return cur && cur.timeframes[tf] ? cur.timeframes[tf].lab : null; };

  // ------------------------------------------------------------------ sentiment
  function gauge(title, g) {
    const wrap = h('div', 'gauge');
    const head = h('div', 'gauge-head');
    head.appendChild(h('b', '', title));
    const cls = g.label === 'Bullish' ? 'bullish' : g.label === 'Bearish' ? 'bearish' : 'neutral';
    head.appendChild(chip(`${g.label} (${sgn(g.score)}${num(g.score)})`, cls));
    wrap.appendChild(head);
    const track = h('div', 'gauge-track');
    const mark = h('div', 'gauge-mark');
    const target = ((Math.max(-1, Math.min(1, g.score)) + 1) / 2) * 100 + '%';
    mark.style.left = '50%';
    track.appendChild(mark);
    setTimeout(() => { mark.style.left = target; }, 60); // glides from the middle to its place
    wrap.appendChild(track);
    const sc = h('div', 'gauge-scale');
    ['Bearish', 'Neutral', 'Bullish'].forEach((t) => sc.appendChild(h('span', '', t)));
    wrap.appendChild(sc);
    wrap.appendChild(h('div', 'note', `Based on ${g.count} headline${g.count === 1 ? '' : 's'} with a clear driver`));
    return wrap;
  }
  async function loadSentiment() {
    const box = $('sentiment');
    try {
      const d = await getJSON('/api/sentiment');
      box.replaceChildren(gauge('Gold', d.gold), gauge('US dollar', d.usd));
      if (d.source === 'sample') box.appendChild(sampleChip());
    } catch { box.replaceChildren(h('p', 'muted', 'Sentiment unavailable.')); }
  }

  // ------------------------------------------------------------------ signal
  async function loadSignal() {
    const box = $('signal');
    tabs($('signal-tabs'), state.tfs.map((t) => [t, t]), state.sigTf, (t) => { state.sigTf = t; loadSignal(); });
    try {
      const s = await getJSON(`/api/signal?tf=${state.sigTf}&strategy=${state.strategy}`);
      box.replaceChildren();
      if (s.status !== 'ok') {
        box.appendChild(h('p', 'muted', 'Waiting for candle data (need about 80 closed bars)...'));
        return;
      }
      const dir = s.direction;
      state.lastSignal = s;
      box.appendChild(h('div', 'sig-badge ' + dir, dir.toUpperCase()));
      if (s.pause && s.pause.active) {
        const back = new Date(s.pause.event.resumesAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        box.appendChild(chip(`PAUSED: ${s.pause.event.name}, resumes ${back}`, 'sample'));
        box.appendChild(h('p', 'note', 'A high-impact event is close. Many traders stay out until the news has passed. The backtests do not include this rule.'));
      }
      if (calcSync) calcSync();
      const kv = h('dl', 'kv');
      const add = (k, v) => { kv.appendChild(h('dt', '', k)); kv.appendChild(h('dd', '', v)); };
      if (dir !== 'hold') {
        add('Entry', num(s.entry)); add('Stop loss', num(s.stopLoss)); add('Take profit', num(s.takeProfit));
      } else {
        box.appendChild(h('p', 'muted', 'No new setup on the latest closed bar.'));
      }
      (s.details || []).forEach((d) => add(d.label, d.value));
      box.appendChild(kv);
      const ls = labStatus(state.sigTf);
      if (ls && ls.label === 'Promising') box.appendChild(chip(`Test lab: Promising${ls.confirmed ? ' (confirmed)' : ' (waiting for confirmation)'}`, 'bullish'));
      else box.appendChild(h('p', 'note', ls && ls.label ? `Test lab verdict for this strategy on ${state.sigTf}: ${ls.label}. Treat its signals as something to watch, not to trade.` : 'This strategy has not been through the test lab yet. Treat its signals as something to watch, not to trade.'));
      if (s.lastAction && dir === 'hold') {
        const a = s.lastAction;
        box.appendChild(h('p', 'note', `Last signal: ${a.direction.toUpperCase()} at ${num(a.entry)} (SL ${num(a.stopLoss)}, TP ${num(a.takeProfit)}), ${a.barsAgo} bar${a.barsAgo === 1 ? '' : 's'} ago.`));
      }
      box.appendChild(h('p', 'note', `Based on the ${s.timeframe} bar that closed ${when(s.asOf)}. ${s.strategy ? s.strategy.rule : ''}`));
      if (s.dataSource === 'sample') box.appendChild(sampleChip());
    } catch { box.replaceChildren(h('p', 'muted', 'Signal unavailable.')); }
  }

  // ------------------------------------------------------------------ news
  const seenNews = new Set();
  function renderTape() {
    const track = $('tape-track'), tape = $('tape');
    const items = state.news.slice(0, 12);
    track.replaceChildren();
    if (!items.length) { tape.hidden = true; return; }
    tape.hidden = false;
    for (let round = 0; round < 2; round++) { // listed twice so the scroll loops without a gap
      items.forEach((n) => {
        const it = h('span', 'tape-item');
        const bias = n.goldBias;
        it.appendChild(h('span', 'ar ' + (bias === 'bullish' ? 'up' : bias === 'bearish' ? 'down' : 'flat'), bias === 'bullish' ? '\u25B2' : bias === 'bearish' ? '\u25BC' : '\u2022'));
        it.appendChild(document.createTextNode(n.title));
        track.appendChild(it);
      });
    }
  }
  function renderNews() {
    const box = $('news');
    box.replaceChildren();
    if (!state.news.length) {
      box.appendChild(h('p', 'muted', state.newsSource === 'sample'
        ? 'No sample news yet.'
        : 'No news yet. The feeds are polled every 2 minutes. If this stays empty, open /api/status to see which feeds failed.'));
      return;
    }
    const scroll = h('div', 'news-scroll');
    state.news.forEach((n) => {
      const isNew = Date.now() / 1000 - n.publishedAt < 600;
      const fresh = seenNews.size > 0 && !seenNews.has(n.id);
      const item = h('article', 'news-item' + (n.high ? ' high' : '') + (fresh ? ' fresh' : ''));
      const title = n.url ? h('a', 'news-title', n.title) : h('span', 'news-title', n.title);
      if (n.url) { title.href = n.url; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
      item.appendChild(title);
      const meta = h('div', 'news-meta');
      if (isNew) meta.appendChild(chip('NEW', 'new'));
      if (n.high) meta.appendChild(chip('HIGH IMPACT', 'high'));
      meta.appendChild(chip('Gold: ' + cap(n.goldBias), n.goldBias));
      meta.appendChild(chip('USD: ' + cap(n.usdBias), n.usdBias));
      meta.appendChild(h('span', '', `${n.source} - ${ago(n.publishedAt)}`));
      item.appendChild(meta);
      if (n.reason) item.appendChild(h('div', 'why', 'Why: ' + n.reason));
      scroll.appendChild(item);
    });
    box.appendChild(scroll);
    state.news.forEach((n) => seenNews.add(n.id));
    if (state.newsSource === 'sample') box.appendChild(sampleChip());
    renderTape();
  }
  async function loadNews() {
    tabs($('news-filters'), [['all', 'All'], ['gold', 'Gold'], ['usd', 'USD'], ['high', 'High impact']], state.newsFilter,
      (f) => { state.newsFilter = f; loadNews(); });
    try {
      const d = await getJSON('/api/news?filter=' + state.newsFilter);
      state.news = d.items; state.newsSource = d.source;
      renderNews();
    } catch { $('news').replaceChildren(h('p', 'muted', 'News unavailable.')); }
  }

  // ------------------------------------------------------------------ events
  async function loadEvents() {
    const box = $('events');
    try {
      const d = await getJSON('/api/events');
      state.events = d.items; renderNext();
      box.replaceChildren();
      if (!d.items.length) { box.appendChild(h('p', 'muted', 'No upcoming high or medium impact US events loaded yet.')); return; }
      d.items.forEach((e) => {
        const row = h('div', 'ev');
        const left = h('div');
        left.appendChild(h('div', 'ev-name', e.name));
        const sub = [e.forecast && 'Forecast ' + e.forecast, e.previous && 'Previous ' + e.previous, e.actual && 'Actual ' + e.actual].filter(Boolean).join('  |  ');
        if (sub) left.appendChild(h('div', 'ev-sub', sub));
        const right = h('div', 'ev-right');
        right.appendChild(chip(cap(e.impact), e.impact === 'high' ? 'high' : 'neutral'));
        right.appendChild(h('div', 'ev-sub', `${when(e.ts)} (${inTime(e.ts)})`));
        row.append(left, right);
        box.appendChild(row);
      });
      if (d.source === 'sample') box.appendChild(sampleChip());
    } catch { box.replaceChildren(h('p', 'muted', 'Events unavailable.')); }
  }

  // ------------------------------------------------------------------ performance
  const exportLink = (text, href) => { const a = h('a', 'tab', text); a.href = href; a.setAttribute('download', ''); return a; };
  const tile = (label, value, cls) => {
    const t = h('div', 'tile');
    t.appendChild(h('div', 'l', label));
    t.appendChild(h('div', 'v' + (cls ? ' ' + cls : ''), value));
    return t;
  };
  async function loadPerf() {
    const box = $('perf');
    tabs($('perf-tabs'), state.tfs.map((t) => [t, t]), state.perfTf, (t) => { state.perfTf = t; loadPerf(); });
    try {
      const p = await getJSON(`/api/performance?tf=${state.perfTf}&strategy=${state.strategy}`);
      box.replaceChildren();
      if (p.status !== 'ok') { box.appendChild(h('p', 'muted', 'Backtest runs once candle data is available.')); return; }
      const m = p.metrics;
      const tiles = h('div', 'tiles');
      tiles.append(
        tile('Trades', String(m.trades)),
        tile('Win rate', num(m.winRate * 100, 1) + '%'),
        tile('Profit factor', m.profitFactor == null ? 'no losses' : num(m.profitFactor)),
        tile('Net (points)', sgn(m.netProfit) + num(m.netProfit), m.netProfit >= 0 ? 'pos' : 'neg'),
        tile('Max drawdown', num(m.maxDrawdown), 'neg'),
        tile('Avg win / loss', `${num(m.avgWin)} / ${num(m.avgLoss)}`)
      );
      box.appendChild(tiles);
      box.appendChild(h('p', 'note', `Equity: start 0, end ${sgn(m.netProfit)}${num(m.netProfit)}, peak ${num(m.peak)} (points = USD per oz). ` +
        `${p.window.bars} bars, ${whenY(p.window.from)} to ${whenY(p.window.to)}. ${m.signals != null ? `Signals found: ${m.signals}, completed trades: ${m.trades}. ` : ''}Costs included: ${num(p.params.costPerTrade)} points per trade. ` +
        'A stop and a target on the same bar counts as a stop.'));
      box.appendChild(exportLink('Download all trades (CSV)', `/api/export/trades.csv?tf=${state.perfTf}&strategy=${state.strategy}`));
      if (p.trades.length) {
        const wrap = h('div', 'tbl-wrap');
        const table = h('table');
        const head = h('tr');
        ['Exit', 'Side', 'Entry', 'Exit', 'P/L'].forEach((c) => head.appendChild(h('th', '', c)));
        table.appendChild(head);
        p.trades.slice(0, 20).forEach((t) => {
          const tr = h('tr');
          tr.appendChild(h('td', '', whenYT(t.exit_ts)));
          tr.appendChild(h('td', '', t.direction.toUpperCase()));
          tr.appendChild(h('td', '', num(t.entry)));
          tr.appendChild(h('td', '', num(t.exit)));
          tr.appendChild(h('td', t.pnl >= 0 ? 'pos' : 'neg', sgn(t.pnl) + num(t.pnl)));
          table.appendChild(tr);
        });
        wrap.appendChild(table);
        box.appendChild(wrap);
      } else {
        box.appendChild(h('p', 'muted', 'No completed trades in this window.'));
      }
      if (p.dataSource === 'sample') box.appendChild(sampleChip());
    } catch { box.replaceChildren(h('p', 'muted', 'Performance unavailable.')); }
  }

  // ------------------------------------------------------------------ data-source strip and warnings
  async function loadSources() {
    try {
      const s = await getJSON('/api/status');
      const strip = $('sources');
      strip.replaceChildren();
      const add = (label, src, ok) => strip.appendChild(chip(`${label}: ${src}`, src === 'sample' || src === 'mock' ? 'sample' : ok === false ? 'bearish' : 'neutral'));
      add('Price', s.price.source, s.price.status === 'live');
      const tfs = Object.values(s.candles.timeframes);
      add('Candles', s.candles.source, tfs.length ? tfs.every((t) => t.ok) : undefined);
      const feeds = s.news.feeds || [];
      add('News', s.news.source === 'rss' ? `rss (${feeds.filter((f) => f.ok).length}/${feeds.length} feeds)` : s.news.source, s.news.source === 'rss' ? feeds.some((f) => f.ok) : true);
      add('Calendar', s.calendar.source, s.calendar.ok !== false);

      const fake = [];
      if (s.price.source === 'mock') fake.push('price');
      if (s.candles.source === 'sample') fake.push('candles');
      if (s.news.source === 'sample') fake.push('news');
      if (s.calendar.source === 'sample') fake.push('calendar');
      $('version').textContent = 'v' + s.version;
      $('settings-status').textContent = `Key: ${s.keySet ? 'saved' : 'not set'}. Candles source: ${s.candles.source}.`;
      renderBanner(fake);
    } catch { /* strip is informational */ }
  }

  function buildKeyForm() {
    const wrap = h('div');
    const form = h('div', 'keyform');
    const input = h('input'); input.type = 'text'; input.placeholder = 'Paste key here'; input.autocomplete = 'off'; input.spellcheck = false;
    const btn = h('button', 'keybtn', 'Save and use real data'); btn.type = 'button';
    const msg = h('div', 'keymsg');
    const submit = async () => {
      const key = input.value.trim();
      if (!key) { msg.textContent = 'Paste your key first.'; return; }
      btn.disabled = true; msg.textContent = 'Checking the key with Twelve Data...';
      try {
        const r = await fetch('/api/settings/twelvedata-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Something went wrong.');
        input.value = '';
        msg.textContent = d.saved ? 'Key accepted and saved. Loading real candles...' : 'Key accepted for this session (could not write .env). Loading real candles...';
        setTimeout(() => { bannerSig = null; refreshAll(); }, 4000);
        setTimeout(() => { bannerSig = null; refreshAll(); }, 12000);
      } catch (err) { msg.textContent = err.message; }
      btn.disabled = false;
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    form.append(input, btn);
    wrap.append(form, msg);
    return wrap;
  }

  // The banner is rebuilt only when what it says changes, so typing in the key box is never wiped.
  let bannerSig = null;
  function renderBanner(fake) {
    const sig = fake.join(',');
    if (sig === bannerSig) return;
    bannerSig = sig;
    const banner = $('banner');
    banner.replaceChildren();
    if (!fake.length) { banner.hidden = true; return; }
    banner.hidden = false;
    banner.appendChild(h('div', '', `Sample data in use for: ${fake.join(', ')}. These numbers are fake and must not be used to judge the strategy.`));
    if (!fake.includes('candles')) return;

    banner.appendChild(h('div', 'banner-help', 'For real candles, paste your free Twelve Data key here (from twelvedata.com, Dashboard, API Key):'));
    banner.appendChild(buildKeyForm());
  }

  // ------------------------------------------------------------------ test lab
  const sg = (n, d = 2) => (n == null || !Number.isFinite(+n) ? '--' : (n > 0 ? '+' : '') + Number(n).toFixed(d));
  const pf = (n) => (n == null ? 'no losses' : Number(n).toFixed(2));
  const pct = (n) => (n == null ? '--' : Math.round(n * 100) + '%');
    const day = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const simpleTable = (heads, rows) => {
    const wrap = h('div', 'tbl-wrap'); const t = h('table'); const hr = h('tr');
    heads.forEach((c) => hr.appendChild(h('th', '', c))); t.appendChild(hr);
    rows.forEach((r) => { const tr = h('tr'); r.forEach((c) => {
      const cls = typeof c === 'object' && c ? c.cls : ''; const txt = typeof c === 'object' && c ? c.t : c;
      tr.appendChild(h('td', cls, txt)); }); t.appendChild(tr); });
    wrap.appendChild(t); return wrap;
  };
  const sec = (title, ...kids) => { const s2 = h('div', 'lab-sec'); s2.appendChild(h('h3', '', title)); kids.forEach((k) => s2.appendChild(k)); return s2; };
  const posneg = (n, text) => ({ t: text, cls: n > 0 ? 'pos' : n < 0 ? 'neg' : '' });

  let labTf = 'H1', labTimer = null;
  function stopLabPoll() { if (labTimer) { clearInterval(labTimer); labTimer = null; } }

  async function runLab(which) {
    try {
      await fetch(`/api/lab/run?tf=${labTf}&strategy=${which || state.strategy}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch { /* shown by the next poll */ }
    loadLab();
  }

  async function loadLab() {
    const box = $('lab');
    tabs($('lab-tabs'), state.tfs.map((t) => [t, t]), labTf, (t) => { labTf = t; stopLabPoll(); loadLab(); });
    let d;
    let sumList = [];
    try { sumList = await getJSON('/api/lab/summary?tf=' + labTf); } catch { /* table is optional */ }
    try { d = await getJSON(`/api/lab?tf=${labTf}&strategy=${state.strategy}`); } catch { box.replaceChildren(h('p', 'muted', 'Test lab unavailable.')); return; }
    const running = d.status === 'running' || sumList.some((x) => x.running);
    if (running && !labTimer) labTimer = setInterval(loadLab, 2000);
    if (!running) stopLabPoll();

    box.replaceChildren();
    const bar = h('div', 'lab-bar');
    const btn = h('button', 'labbtn', running ? 'Running...' : (d.result ? 'Run again' : 'Run test lab'));
    btn.type = 'button'; btn.disabled = running; btn.addEventListener('click', () => runLab());
    bar.appendChild(btn);
    const allBtn = h('button', 'labbtn', 'Run all strategies');
    allBtn.type = 'button'; allBtn.disabled = running; allBtn.addEventListener('click', () => runLab('all'));
    bar.appendChild(allBtn);
    if (running) {
      const pg = h('div', 'progress'); const fill = h('div'); fill.style.width = (d.progress ? d.progress.pct : 0) + '%'; pg.appendChild(fill);
      bar.append(pg, h('span', 'note', d.progress ? `${d.progress.step} (${d.progress.pct}%)` : 'Starting'));
    } else if (d.result) {
      bar.appendChild(h('span', 'note', `${d.result.strategy ? d.result.strategy.label + ': l' : 'L'}ast run ${whenYT(d.result.ranAt)} on ${d.result.window.bars} cleaned bars, ${day(d.result.window.from)} to ${day(d.result.window.to)}`));
      if (d.result.dataSource === 'sample') bar.appendChild(sampleChip());
    }
    box.appendChild(bar);
    if (sumList.length) {
      const rows = sumList.map((x) => [x.label + (x.selectedOnSeenData ? ' *' : ''),
        x.running ? 'running...' : x.verdict ? '' : 'not tested', x.passed != null ? `${x.passed} of ${x.total}` : '--',
        x.avgR != null ? posneg(x.avgR, sg(x.avgR) + 'R') : '--', x.trades != null ? x.trades : '--',
        x.confirmed ? 'Confirmed' : x.verdict === 'Promising' ? 'Waiting for 2nd pass' : '']);
      const t = simpleTable(['Strategy (click a row to select)', 'Verdict', 'Checks passed', 'Avg R per trade', 'Trades', 'Status'], rows);
      [...t.querySelectorAll('tr')].slice(1).forEach((tr, i) => {
        const x = sumList[i];
        const vcell = tr.children[1];
        if (x.verdict && !x.running) vcell.appendChild(chip(x.verdict, labClass(x.verdict)));
        tr.style.cursor = 'pointer';
        if (x.name === state.strategy) tr.style.fontWeight = '700';
        tr.addEventListener('click', () => selectStrategy(x.name));
      });
      box.appendChild(sec('All strategies side by side (' + labTf + ')', t, h('p', 'note', '* settings chosen after looking at this history, so its lab results are optimistic. Selected strategy: ' + state.strategy + '.')));
    }
    if (d.status === 'error') { box.appendChild(h('p', 'muted', 'The lab could not run: ' + d.error)); return; }
    if (!d.result) {
      box.appendChild(h('p', 'muted', 'The test lab checks whether the strategy\'s results look like a real edge or like luck: year by year, on data it was not tuned on, with other settings, and with higher costs. It takes a few seconds.'));
      return;
    }
    renderLab(box, d.result);
  }

  function renderLab(box, r) {
    // verdict
    const v = r.verdict;
    const vbox = h('div', 'verdict');
    vbox.appendChild(h('span', 'big ' + (v.label === 'Promising' ? 'good' : v.label === 'Mixed' ? 'mid' : 'bad'), v.label));
    vbox.appendChild(h('span', 'note', `${v.passed} of ${v.total} checks passed. ${v.note}`));
    box.appendChild(vbox);
    v.checks.forEach((c) => {
      const row = h('div', 'check');
      row.appendChild(chip(c.pass ? 'PASS' : 'FAIL', c.pass ? 'bullish' : 'bearish'));
      const txt = h('div'); txt.appendChild(h('div', 'l', c.label)); txt.appendChild(h('div', 'd', c.detail)); row.appendChild(txt);
      box.appendChild(row);
    });
    box.appendChild(h('p', 'note', 'R = the amount risked on a trade. +1R means the trade won as much as was risked, -1R means a full stop-out. Average R per trade is the fairest way to compare periods when gold\'s price level changes.'));

    // by year / quarter
    const per = (rows) => simpleTable(['Period', 'Trades', 'Win rate', 'Net R', 'Net points', 'Profit factor'],
      rows.map((p) => [p.period, p.trades, pct(p.winRate), posneg(p.netR, sg(p.netR)), posneg(p.netPoints, sg(p.netPoints, 1)), pf(p.profitFactor)]));
    const detQ = h('details'); detQ.appendChild(h('summary', '', 'By quarter')); detQ.appendChild(per(r.periods.byQuarter));
    box.appendChild(sec('Results by period (is the edge steady?)', per(r.periods.byYear), detQ));

    // walk-forward
    const wf = r.walkForward;
    const rowsWf = wf.folds.map((f) => f.skipped ? [String(f.fold), { t: f.reason }, '', '', '', ''] : [
      String(f.fold), `${day(f.test.from)} to ${day(f.test.to)}`, f.chosenText || '',
      f.testOptimized.trades, posneg(f.testOptimized.avgR, sg(f.testOptimized.avgR)), posneg(f.testDefault.avgR, sg(f.testDefault.avgR))]);
    box.appendChild(sec('Walk-forward: tuned on the past, tested on data it never saw',
      simpleTable(['Fold', 'Unseen period', 'Settings chosen from the past', 'Trades', 'Avg R (tuned)', 'Avg R (original settings)'], rowsWf),
      h('p', 'note', `Pooled unseen results: tuned settings ${wf.pooledOptimized.trades} trades, ${sg(wf.pooledOptimized.avgR)}R per trade; original settings ${wf.pooledDefault.trades} trades, ${sg(wf.pooledDefault.avgR)}R per trade.`)));

    // sweep
    const sw = r.sweep;
    const swKids = [h('p', 'note', sw.profitableShare == null ? 'Not enough trades to judge the settings.' :
      `${sw.combos} settings combinations tested; ${pct(sw.profitableShare)} of the ${sw.eligible} with ${sw.minTrades}+ trades were profitable (median ${sg(sw.medianAvgR)}R per trade). ${sw.defaultRank ? `The original settings rank ${sw.defaultRank} of ${sw.eligible}.` : ''}`)];
    if (sw.best.length) swKids.push(simpleTable(['Best settings found', 'Trades', 'Avg R', 'Profit factor'], sw.best.map((b) => [b.text, b.trades, posneg(b.avgR, sg(b.avgR)), pf(b.profitFactor)])));
    swKids.push(h('p', 'note', 'These best settings are shown for information only. Picking the best of many tries on the same data flatters the result, which is why the walk-forward test above matters more.'));
    box.appendChild(sec('Settings sweep (does it only work with exact settings?)', ...swKids));

    // costs and luck
    box.appendChild(sec('Higher costs (spread and slippage)', simpleTable(['Cost per trade (points)', 'Trades', 'Avg R', 'Net R', 'Profit factor'],
      r.costTests.map((c) => [c.costPerTrade, c.trades, posneg(c.avgR, sg(c.avgR)), posneg(c.netR, sg(c.netR)), pf(c.profitFactor)]))));
    const bs = r.bootstrap;
    box.appendChild(sec('Luck check', h('p', 'note', bs ? `Resampling the trades ${bs.iters} times: the average result per trade is between ${sg(bs.p05)}R and ${sg(bs.p95)}R in 90% of resamples, and positive in ${pct(bs.probPositive)} of them. A range that includes zero means the edge could be luck.` : 'Not enough trades.')));

    // data quality
    const dq = r.dataQuality;
    box.appendChild(sec('Data quality', h('p', 'note',
      `${dq.bars} bars checked: ${dq.flatBars} flat bars, ${dq.weekendBars} bars inside the weekend market closure (${pct(dq.weekendShare)}). ${dq.bars - dq.cleanedBars} bars were removed for the tests above. ` +
      `Original strategy on raw data: ${dq.rawResult.trades} trades, ${sg(dq.rawResult.avgR)}R per trade; on cleaned data: ${dq.cleanedResult.trades} trades, ${sg(dq.cleanedResult.avgR)}R per trade.`)));
    box.appendChild(h('p', 'note', 'Analysis only, not financial advice. Past results do not guarantee future results.'));
  }

  // ------------------------------------------------------------------ strategies, journal, alerts
  function selectStrategy(name) {
    state.strategy = name;
    const sel = $('strategy-select');
    if (sel) sel.value = name;
    stopLabPoll();
    loadStrategies(); loadSignal(); loadPerf(); loadJournal(); loadLab();
  }

  let strategiesInit = false;
  async function loadStrategies() {
    try { state.strategies = await getJSON('/api/strategies'); } catch { return; }
    const sel = $('strategy-select');
    if (!strategiesInit) {
      strategiesInit = true;
      state.strategies.forEach((x) => { const o = h('option', '', x.label); o.value = x.name; sel.appendChild(o); });
      const confirmed = state.strategies.find((x) => Object.values(x.timeframes).some((t) => t.lab && t.lab.confirmed));
      if (confirmed) state.strategy = confirmed.name;
      sel.value = state.strategy;
      sel.addEventListener('change', () => selectStrategy(sel.value));
      loadSignal(); loadPerf(); loadJournal(); loadLab();
    }
    const cur = state.strategies.find((x) => x.name === state.strategy);
    if (!cur) return;
    $('strategy-desc').textContent = cur.description + (cur.selectedOnSeenData ? ' Its settings were chosen after looking at the history, so lab results are optimistic.' : '');
    const st = $('strategy-status');
    st.replaceChildren();
    state.tfs.forEach((tf) => {
      const l = cur.timeframes[tf] && cur.timeframes[tf].lab;
      st.appendChild(chip(`${tf}: ${l && l.label ? l.label + (l.confirmed ? ' (confirmed)' : '') : 'not tested'}`, labClass(l && l.label)));
    });
  }

  let journalTf = 'H1';
  async function loadJournal() {
    const box = $('journal');
    tabs($('journal-tabs'), state.tfs.map((t) => [t, t]), journalTf, (t) => { journalTf = t; loadJournal(); });
    try {
      const d = await getJSON(`/api/journal?tf=${journalTf}&strategy=${state.strategy}`);
      const m = d.summary;
      box.replaceChildren();
      box.appendChild(h('p', 'note', 'This is the real test. Every signal this strategy gives from now on is recorded and followed to its actual outcome, with nothing back-filled. ' +
        (m.startedAt ? `Journal started ${whenYT(m.startedAt)}.` : 'Journal starts when the first candles load.')));
      const tiles = h('div', 'tiles');
      tiles.append(
        tile('Signals recorded', String(m.signals)),
        tile('Completed trades', `${m.closed} of ${m.neededForVerdict} needed`),
        tile('Win rate', m.closed ? num((m.wins / m.closed) * 100, 0) + '%' : '--'),
        tile('Avg R per trade', m.closed ? sgn(m.avgR) + num(m.avgR) : '--', m.closed && m.avgR > 0 ? 'pos' : m.closed ? 'neg' : ''),
        tile('Open / waiting', `${m.open + m.pending}`),
        tile('Skipped (trade running)', String(m.skipped)));
      box.appendChild(tiles);
      if (m.insidePause && m.insidePause.closed > 0) {
        box.appendChild(h('p', 'note', `Signals inside event-pause windows: ${m.insidePause.closed} trades, ${sgn(m.insidePause.avgR)}${num(m.insidePause.avgR)}R per trade. Outside: ${m.outsidePause.closed} trades, ${sgn(m.outsidePause.avgR)}${num(m.outsidePause.avgR)}R. This shows over time whether staying out of news windows helps.`));
      }
      box.appendChild(exportLink('Download journal (CSV)', `/api/export/journal.csv?tf=${journalTf}&strategy=${state.strategy}`));
      if (d.recent.length) {
        const wrap = h('div', 'tbl-wrap'); const table = h('table'); const head = h('tr');
        ['Signal time', 'Side', 'Status', 'Entry', 'Exit', 'Result (R)'].forEach((c) => head.appendChild(h('th', '', c)));
        table.appendChild(head);
        d.recent.forEach((r) => {
          const tr = h('tr');
          tr.appendChild(h('td', '', whenYT(r.signal_ts)));
          tr.appendChild(h('td', '', r.direction.toUpperCase()));
          tr.appendChild(h('td', '', r.status));
          tr.appendChild(h('td', '', r.entry == null ? '--' : num(r.entry)));
          tr.appendChild(h('td', '', r.exit_price == null ? '--' : num(r.exit_price)));
          tr.appendChild(h('td', r.r == null ? '' : r.r >= 0 ? 'pos' : 'neg', r.r == null ? '--' : sgn(r.r) + num(r.r)));
          table.appendChild(tr);
        });
        wrap.appendChild(table); box.appendChild(wrap);
      } else {
        box.appendChild(h('p', 'muted', 'No live signals recorded yet for this strategy. Keep the platform running: signals can be days apart.'));
      }
    } catch { $('journal').replaceChildren(h('p', 'muted', 'Journal unavailable.')); }
  }

  let alertsData = { unread: 0, items: [] };
  async function markAllRead() {
    try { await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* ignore */ }
    loadAlerts();
  }
  const celebrated = new Set();
  function confetti(box) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#ffd166', '#ff4d8d', '#8b5cf6', '#22d3ee', '#2dffa0'];
    for (let i = 0; i < 36; i++) {
      const c = h('i', 'confetti');
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = Math.random() * 0.5 + 's';
      box.appendChild(c);
    }
  }
  function renderNotice() {
    const box = $('notice');
    const n = alertsData.items.find((i) => !i.read && ['success', 'signal', 'warning'].includes(i.level));
    box.replaceChildren();
    if (!n) { box.hidden = true; return; }
    box.hidden = false;
    box.className = 'notice ' + n.level;
    box.appendChild(h('b', '', n.title));
    box.appendChild(h('div', '', n.body));
    if (n.level === 'success' && !celebrated.has(n.id)) { celebrated.add(n.id); confetti(box); }
    const b = h('button', 'keybtn', 'Got it'); b.type = 'button'; b.addEventListener('click', markAllRead);
    box.appendChild(b);
  }
  function renderAlerts() {
    const list = $('alerts-list');
    list.replaceChildren();
    if (!alertsData.items.length) { list.appendChild(h('p', 'muted', 'No alerts yet. Messages appear here when a strategy passes the test lab, when a passing strategy gives a signal, and when live results come in.')); return; }
    alertsData.items.forEach((n) => {
      const row = h('div', 'alert-item' + (n.read ? '' : ' unread'));
      const t = h('div', 'alert-title');
      t.appendChild(chip(n.level === 'success' ? 'GOOD' : n.level === 'signal' ? 'SIGNAL' : n.level === 'warning' ? 'WARNING' : 'INFO', n.level === 'success' ? 'bullish' : n.level === 'warning' ? 'bearish' : n.level === 'signal' ? 'high' : 'neutral'));
      t.appendChild(h('span', '', n.title));
      t.appendChild(h('span', 'note', whenYT(n.ts)));
      row.appendChild(t);
      if (n.body) row.appendChild(h('div', 'alert-body', n.body));
      list.appendChild(row);
    });
  }
  async function loadAlerts() {
    try { alertsData = await getJSON('/api/notifications'); } catch { return; }
    if (lastUnread !== null && alertsData.unread > lastUnread && soundOn()) beep();
    lastUnread = alertsData.unread;
    $('alerts-count').textContent = alertsData.unread ? `(${alertsData.unread})` : '';
    $('alerts-btn').classList.toggle('ring', alertsData.unread > 0);
    document.title = (alertsData.unread ? `(${alertsData.unread}) ` : '') + 'XAUUSD Platform';
    renderAlerts(); renderNotice();
  }

  // ------------------------------------------------------------------ header extras: next event, sound, calculator
  state.events = [];
  function renderNext() {
    const el2 = $('next-event');
    const nowS = Date.now() / 1000;
    const n = state.events.find((e) => e.ts > nowS && e.impact === 'high') || state.events.find((e) => e.ts > nowS);
    el2.textContent = n ? `Next: ${n.name} ${inTime(n.ts)} (${n.impact})` : '';
  }
  setInterval(renderNext, 30000);

  let lastUnread = null;
  const soundOn = () => { try { return localStorage.getItem('xau_sound') === '1'; } catch { return false; } };
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.25);
    } catch { /* sound is optional */ }
  }

  let calcSync = null;
  function buildCalc() {
    const box = $('calc');
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('xau_calc') || '{}'); } catch { /* ignore */ }
    const fields = {};
    const grid = h('div', 'calc-grid');
    const field = (key, label, value, step) => {
      const wrap = h('label', '', label);
      const input = h('input'); input.type = 'number'; input.step = step; input.value = value; input.min = '0';
      input.addEventListener('input', update);
      wrap.appendChild(input); grid.appendChild(wrap); fields[key] = input;
    };
    field('balance', 'Account balance ($)', saved.balance || 1000, '100');
    field('riskPct', 'Risk per trade (%)', saved.riskPct || 1, '0.25');
    field('stop', 'Stop distance (points)', saved.stop || '', '0.5');
    field('tp', 'Target distance (points, optional)', saved.tp || '', '0.5');
    field('oz', 'Ounces per 1.00 lot', saved.oz || 100, '1');
    const useBtn = h('button', 'labbtn', 'Use the current signal'); useBtn.type = 'button';
    const out = h('div', 'calc-out');
    box.append(grid, useBtn, out);
    box.appendChild(h('p', 'note', 'Standard gold lots are usually 100 oz, so a 1.00 move is about $100 per lot. Check your broker\'s contract size and minimum lot. Analysis only, not financial advice.'));

    function fromSignal() {
      const s = state.lastSignal;
      if (!s || s.status !== 'ok') return false;
      const src = s.direction !== 'hold' ? s : s.lastAction;
      if (!src || src.entry == null || src.stopLoss == null) return false;
      fields.stop.value = Math.abs(src.entry - src.stopLoss).toFixed(2);
      fields.tp.value = src.takeProfit != null ? Math.abs(src.takeProfit - src.entry).toFixed(2) : '';
      return true;
    }
    function update() {
      const v = (k) => parseFloat(fields[k].value);
      try { localStorage.setItem('xau_calc', JSON.stringify({ balance: fields.balance.value, riskPct: fields.riskPct.value, stop: fields.stop.value, tp: fields.tp.value, oz: fields.oz.value })); } catch { /* ignore */ }
      out.replaceChildren();
      const r = Calc.calcLots({ balance: v('balance'), riskPct: v('riskPct'), stopPoints: v('stop'), ozPerLot: v('oz') });
      if (!r.valid) { out.appendChild(h('span', 'muted', 'Enter your balance, risk % and a stop distance (or click "Use the current signal").')); return; }
      const big = h('div'); big.appendChild(h('span', 'big', r.belowMinimum ? 'Below minimum lot' : `${r.lots.toFixed(2)} lots`));
      out.appendChild(big);
      out.appendChild(h('div', '', `You asked to risk $${num(r.riskUsd)} (${num(v('riskPct'))}% of $${num(v('balance'))}). A ${num(v('stop'))}-point stop costs $${num(r.perLot)} per 1.00 lot.`));
      if (r.belowMinimum) {
        out.appendChild(h('div', 'calc-warn', `Even the smallest size (0.01 lot) would risk about $${num(r.minLotRisk)} (${num(r.minLotRiskPct)}% of your account), more than you chose. Consider a smaller stop, a bigger account, or skipping this trade.`));
      } else {
        out.appendChild(h('div', '', `At ${r.lots.toFixed(2)} lots, hitting the stop loses about $${num(r.actualRisk)}.` + (v('tp') > 0 ? ` Hitting the target gains about $${num(v('tp') * v('oz') * r.lots)}.` : '')));
      }
      if (v('riskPct') > 2) out.appendChild(h('div', 'calc-warn', 'Risking more than 1 to 2% of your account on one trade can wipe it out quickly after a losing streak.'));
    }
    useBtn.addEventListener('click', () => { if (!fromSignal()) out.textContent = 'No signal with a stop is available yet for this strategy.'; else update(); });
    calcSync = () => { if (!fields.stop.value && fromSignal()) update(); };
    update();
  }

  // ------------------------------------------------------------------ wiring
  const refreshers = { news: loadNews, sentiment: loadSentiment, signal: loadSignal, performance: loadPerf, events: loadEvents,
    notifications: loadAlerts, journal: () => { loadJournal(); loadStrategies(); }, lab: () => { loadLab(); loadStrategies(); } };
  function refreshAll() { loadSources(); loadSentiment(); loadSignal(); loadNews(); loadEvents(); loadPerf(); loadLab(); loadJournal(); loadStrategies(); loadAlerts(); }

  const applyTheme = (t) => { document.documentElement.dataset.theme = t; $('theme-btn').textContent = t === 'dark' ? '\u{1F319}' : '\u2600\uFE0F'; };
  applyTheme(document.documentElement.dataset.theme || 'dark');
  $('theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('xau_theme', next); } catch { /* ignore */ }
  });
  $('alerts-btn').addEventListener('click', () => { $('alerts').hidden = !$('alerts').hidden; });
  $('alerts-read').addEventListener('click', markAllRead);
  $('alerts-sound').checked = soundOn();
  $('alerts-sound').addEventListener('change', (e) => { try { localStorage.setItem('xau_sound', e.target.checked ? '1' : '0'); } catch { /* ignore */ } if (e.target.checked) beep(); });
  buildCalc();

  let settingsBuilt = false;
  $('settings-btn').addEventListener('click', () => {
    const panel = $('settings');
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !settingsBuilt) { $('settings-form').appendChild(buildKeyForm()); settingsBuilt = true; }
  });

  const es = new EventSource('/api/stream');
  es.addEventListener('tick', (e) => onTick(JSON.parse(e.data)));
  es.addEventListener('status', (e) => { serverStatus = JSON.parse(e.data); setStatus(serverStatus); });
  es.addEventListener('update', (e) => { const u = JSON.parse(e.data); if (refreshers[u.type]) refreshers[u.type](); });
  es.onerror = () => { serverStatus = 'reconnecting'; setStatus('reconnecting'); };

  setInterval(() => { if (lastTickAt && Date.now() - lastTickAt > STALE_MS && serverStatus === 'live') setStatus('stale'); }, 2000);
  setInterval(renderNews, 30000);   // keep "x min ago" fresh without refetching
  setInterval(refreshAll, 60000);   // safety net in case a push is missed

  fetch('/api/status').then((r) => r.json()).then((s) => {
    const tfs = s.candles.configured || [];
    if (tfs.length) { state.tfs = tfs; state.sigTf = tfs[0]; state.perfTf = tfs[0]; labTf = tfs[0]; journalTf = tfs[0]; }
  }).catch(() => {}).finally(refreshAll);
})();
