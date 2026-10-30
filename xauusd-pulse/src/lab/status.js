// Decides what to tell the user when a lab run finishes. Pure function, easy to test.
// A strategy is only called "good to go" after it passes the lab on TWO runs at least 12 hours apart,
// so one lucky run on a single set of numbers cannot trigger it.
const CONFIRM_AFTER_SECONDS = 12 * 3600;

// prev: the previous stored result (or null). result: the new result. Returns { confirm, notice }.
function evaluate(prev, result, strategyLabel, tf) {
  const label = result.verdict.label;
  const prevLabel = prev ? prev.verdict.label : null;
  const passed = `${result.verdict.passed} of ${result.verdict.total}`;
  const who = `${strategyLabel} on ${tf}`;
  const caution = result.verdict.note;
  let confirm = { firstPromisingAt: null, confirmed: false };
  let notice = null;

  if (label === 'Promising') {
    const first = prev && prevLabel === 'Promising' && prev.confirm && prev.confirm.firstPromisingAt ? prev.confirm.firstPromisingAt : result.ranAt;
    const confirmed = result.ranAt - first >= CONFIRM_AFTER_SECONDS;
    confirm = { firstPromisingAt: first, confirmed };
    const wasConfirmed = !!(prev && prev.confirm && prev.confirm.confirmed);
    if (confirmed && !wasConfirmed) {
      notice = { level: 'success', kind: 'good_to_go', title: `Good to go for demo testing: ${who}`,
        body: `It passed the test lab (${passed} checks) on two runs, hours apart. Next step: watch its live signals on a demo account. ${caution}`,
        dedupe: `goodtogo:${result.strategy.name}:${tf}:${first}` };
    } else if (!confirmed && prevLabel !== 'Promising') {
      notice = { level: 'info', kind: 'candidate', title: `Passed the lab once: ${who}`,
        body: `${passed} checks passed. It needs to pass again after new data arrives (about 12 hours) before it counts as good to go. ${caution}`,
        dedupe: `candidate:${result.strategy.name}:${tf}:${result.ranAt}` };
    }
  } else if (prevLabel === 'Promising') {
    notice = { level: 'warning', kind: 'lab_dropped', title: `No longer passes the lab: ${who}`,
      body: `It now scores "${label}" (${passed} checks). Do not rely on its signals.`,
      dedupe: `dropped:${result.strategy.name}:${tf}:${result.ranAt}` };
  } else if (prevLabel !== label) {
    notice = { level: 'info', kind: 'lab_result', title: `Lab result: ${who} is "${label}"`,
      body: `${passed} checks passed. ${caution}`,
      dedupe: `labresult:${result.strategy.name}:${tf}:${result.ranAt}` };
  }
  return { confirm, notice };
}

module.exports = { evaluate, CONFIRM_AFTER_SECONDS };
