const test = require('node:test');
const assert = require('node:assert');
const { upsertEnvLine } = require('../src/lib/envFile');

test('replaces an existing empty key line and keeps other lines', () => {
  const out = upsertEnvLine('PORT=3000\nTWELVEDATA_API_KEY=\nPRICE_SOURCE=binance\n', 'TWELVEDATA_API_KEY', 'abc12345');
  assert.strictEqual(out, 'PORT=3000\nTWELVEDATA_API_KEY=abc12345\nPRICE_SOURCE=binance\n');
});
test('adds the key when missing, and handles Windows line endings and an empty file', () => {
  assert.strictEqual(upsertEnvLine('PORT=3000\r\n', 'TWELVEDATA_API_KEY', 'k12345678'), 'PORT=3000\nTWELVEDATA_API_KEY=k12345678\n');
  assert.strictEqual(upsertEnvLine('', 'TWELVEDATA_API_KEY', 'k12345678'), 'TWELVEDATA_API_KEY=k12345678\n');
});
test('tolerates spaces around the equals sign, and does not touch commented lines', () => {
  const out = upsertEnvLine('# TWELVEDATA_API_KEY=old\nTWELVEDATA_API_KEY = x\n', 'TWELVEDATA_API_KEY', 'new12345');
  assert.strictEqual(out, '# TWELVEDATA_API_KEY=old\nTWELVEDATA_API_KEY=new12345\n');
});
