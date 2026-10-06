// Test-process preload: simulate an absent TOS installation without touching it.
const fs = require('node:fs');
const path = require('node:path');
const {fileURLToPath} = require('node:url');
const {syncBuiltinESMExports} = require('node:module');
const root = '/Applications/TradeOrderSystem.app';
const attempts = [];
const writeReport = fs.writeFileSync;
function missing(value, operation) {
  if (typeof value === 'number' || value === undefined) return false;
  const file = path.resolve(value instanceof URL ? fileURLToPath(value) : String(value));
  if (file !== root && !file.startsWith(root + path.sep)) return false;
  attempts.push({operation});
  return true;
}
for (const name of ['existsSync', 'readFileSync', 'openSync', 'statSync', 'lstatSync', 'readdirSync', 'realpathSync']) {
  const original = fs[name];
  fs[name] = function(...args) {
    if (missing(args[0], name)) {
      if (name === 'existsSync') return false;
      const error = new Error('ENOENT: simulated missing TOS installation');
      error.code = 'ENOENT';
      throw error;
    }
    return original.apply(this, args);
  };
  Object.assign(fs[name], original);
}
syncBuiltinESMExports();
if (process.env.LAI_NO_TOS_GUARD_DIR) process.on('exit', () => {
  writeReport(path.join(process.env.LAI_NO_TOS_GUARD_DIR, `no-tos-${process.pid}.json`),
    JSON.stringify({pid:process.pid, simulatedMissing:true, attempts, actualTosReads:0}, null, 2));
});
