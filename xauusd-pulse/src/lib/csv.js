// Minimal CSV writer (quotes fields that contain commas, quotes or line breaks).
const esc = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (columns, rows) => [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
module.exports = { toCsv, esc };
