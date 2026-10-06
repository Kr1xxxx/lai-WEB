// Test-process preload only. Refuse formal data before content is opened or copied.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {fileURLToPath} = require('node:url');
const sqlite = require('node:sqlite');
const roots = ['LaiCRM', 'TradeOrderSystem', 'TradeOrderSystem-OKKIPreview']
  .map(name => ({name, directory:path.join(os.homedir(), 'Library/Application Support', name)}));
const blocked = [];
const originalWrite = fs.writeFileSync;
function check(value, operation) {
  if (typeof value === 'number' || value === undefined) return;
  const file = path.resolve(value instanceof URL ? fileURLToPath(value) : String(value));
  const formal = roots.find(({directory}) => file === directory || file.startsWith(directory + path.sep));
  const seed = /\.app\/Contents\/Resources\/trade-order-data\.json$/.test(file);
  if (!formal && !seed) return;
  blocked.push({operation, target:formal?.name || 'app-seed'});
  throw Error('LAI_TEST_DATA_BLOCK: ' + operation + ' refused formal data');
}
for (const name of ['existsSync','lstatSync','lstat','statSync','stat','readdirSync','readdir','realpathSync','realpath',
  'readFileSync','readFile','openSync','open','writeFileSync','writeFile',
  'copyFileSync','copyFile','cpSync','cp','renameSync','rename','rmSync','rm','mkdirSync','mkdir']) {
  const original = fs[name];
  fs[name] = function(...args) {
    check(args[0], name);
    if (/^(copyFile|cp|rename)/.test(name)) check(args[1], name);
    return original.apply(this, args);
  };
  Object.assign(fs[name], original);
}
sqlite.DatabaseSync = new Proxy(sqlite.DatabaseSync, {
  construct(target, args, newTarget) {
    check(args[0], 'DatabaseSync');
    return Reflect.construct(target, args, newTarget);
  }
});
if (process.env.LAI_TEST_DATA_GUARD_DIR) process.on('exit', () => {
  originalWrite(path.join(process.env.LAI_TEST_DATA_GUARD_DIR, 'guard-' + process.pid + '.json'),
    JSON.stringify({pid:process.pid, blocked}, null, 2));
});
