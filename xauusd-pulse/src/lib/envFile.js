// Update (or add) one KEY=value line in the text of a .env file, leaving every other line alone.
function upsertEnvLine(text, key, value) {
  const re = new RegExp('^\\s*' + key + '\\s*=');
  let found = false;
  const out = String(text || '').split(/\r?\n/).map((line) => {
    if (re.test(line)) { found = true; return `${key}=${value}`; }
    return line;
  });
  if (!found) {
    while (out.length && out[out.length - 1] === '') out.pop();
    out.push(`${key}=${value}`);
  }
  return out.join('\n').replace(/\n*$/, '\n');
}
module.exports = { upsertEnvLine };
