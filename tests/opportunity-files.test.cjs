const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createOpportunityFiles, BLOCKED_EXTENSIONS, MAX_BYTES } = require('../backend/opportunity-files.js');
const OM = require('../src/opportunity-model.js');

const temp = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-oppfiles-'));
const code = fn => { try { fn(); } catch (error) { return error.code || error.message; } return 'no error'; };

test('the blocked list and the size limit are the same in the model and the backend', () => {
  assert.deepEqual([...OM.BLOCKED_EXTENSIONS].sort(), [...BLOCKED_EXTENSIONS].sort());
  assert.equal(OM.ATTACHMENT_LIMITS.maxBytes, MAX_BYTES);
  assert.equal(OM.attachmentName('  ../../etc/pass\u202ewd.txt '), '_.._etc_passwd.txt');
  for (const name of ['../../../escape.txt', '..\\win\\x.txt', 'a/b.png', '报价\u0000单.pdf']) assert.equal(OM.attachmentName(name), createOpportunityFiles({ attachmentsDir: path.join(temp(), 'a'), downloadsDir: '/nonexistent' }).upload({ id: 'o', name, body: Buffer.from('x') }).file.name, name);
});

test('upload stores the file under attachments/opportunities, read returns it, remove deletes it', () => {
  const root = temp(), downloads = path.join(root, 'dl'), revealed = [];
  const files = createOpportunityFiles({ attachmentsDir: path.join(root, 'attachments'), downloadsDir: downloads, reveal: file => revealed.push(file) });
  const bytes = Buffer.from('PNGDATA');
  const up = files.upload({ id: 'opp-1', name: '报价单 final?.png', type: 'image/png', body: bytes });
  assert.equal(up.ok, true);
  assert.equal(up.file.name, '报价单 final?.png');
  assert.equal(up.file.size, 7);
  assert.equal(up.file.type, 'image/png');
  assert.match(up.file.fileUrl, /^\/attachments\/opportunities\/opp-1\/[0-9a-f]{10}-[^/]+\.png$/);
  const onDisk = path.join(root, 'attachments', decodeURIComponent(up.file.fileUrl.slice('/attachments/'.length)));
  assert.equal(fs.readFileSync(onDisk, 'utf8'), 'PNGDATA');
  assert.equal(fs.statSync(onDisk).mode & 0o777, 0o600);

  const read = files.read(up.file.fileUrl);
  assert.equal(read.type, 'image/png');
  assert.match(read.headers['Content-Disposition'], /^inline;/);
  assert.equal(read.body.toString(), 'PNGDATA');

  // 不信任上传时声明的类型：SVG、HTML 一律按下载处理。
  for (const name of ['x.svg', 'x.html', 'x.pdf', 'x.docx']) {
    const item = files.upload({ id: 'opp-1', name, type: 'image/png', body: Buffer.from('<svg onload=alert(1)>') });
    const got = files.read(item.file.fileUrl);
    assert.match(got.headers['Content-Disposition'], /^attachment;/, name);
    assert.doesNotMatch(got.type, /^image\//, name);
    assert.match(got.headers['Content-Security-Policy'], /sandbox/);
  }

  const copy = files.saveCopy({ fileUrl: up.file.fileUrl, name: '改过的名字.png' });
  assert.equal(copy.filename, '改过的名字.png');
  assert.equal(fs.readFileSync(path.join(downloads, '改过的名字.png'), 'utf8'), 'PNGDATA');
  assert.equal(files.saveCopy({ fileUrl: up.file.fileUrl, name: '改过的名字.png' }).filename, '改过的名字 (1).png');
  assert.equal(revealed.length, 2);

  assert.deepEqual(files.remove([up.file.fileUrl]), { ok: true, removed: 1 });
  assert.equal(fs.existsSync(onDisk), false);
  assert.deepEqual(files.remove([up.file.fileUrl]), { ok: true, removed: 0 });
  assert.equal(code(() => files.read(up.file.fileUrl)), 'not_found');
  fs.rmSync(root, { recursive: true, force: true });
});

test('upload refuses executables, empty files, oversize files and bad ids; names cannot escape', () => {
  const root = temp();
  const files = createOpportunityFiles({ attachmentsDir: path.join(root, 'attachments'), downloadsDir: path.join(root, 'dl') });
  for (const name of ['setup.exe', 'run.SH', 'a.pdf.app', 'x.command', 'Installer.dmg', 'y.JAR']) assert.equal(code(() => files.upload({ id: 'o', name, body: Buffer.from('x') })), 'blocked_type', name);
  assert.equal(code(() => files.upload({ id: 'o', name: 'a.txt', body: Buffer.alloc(0) })), 'invalid_input');
  assert.equal(code(() => files.upload({ id: 'o', name: '', body: Buffer.from('x') })), 'invalid_input');
  assert.equal(code(() => files.upload({ id: 'o', name: 'big.bin.txt', body: Buffer.alloc(MAX_BYTES + 1) })), 'too_large');
  assert.equal(files.upload({ id: 'o', name: 'edge.txt', body: Buffer.alloc(MAX_BYTES) }).file.size, MAX_BYTES);
  assert.equal(code(() => files.upload({ id: '', name: 'a.txt', body: Buffer.from('x') })), 'invalid_input');
  // 商机编号里的路径字符不会进到路径里；不同编号即使清洗后相同也落在不同文件夹。
  const a = files.upload({ id: '../../x', name: 'a.txt', body: Buffer.from('1') }).file.fileUrl, b = files.upload({ id: '__x', name: 'a.txt', body: Buffer.from('2') }).file.fileUrl;
  assert.notEqual(path.dirname(a), path.dirname(b));
  for (const url of [a, b]) assert.match(url, /^\/attachments\/opportunities\/[A-Za-z0-9_-]+\/[^/]+$/);
  const traversal = files.upload({ id: 'o', name: '../../../escape.txt', body: Buffer.from('x') });
  assert.equal(traversal.file.name, '_.._.._escape.txt');
  assert.ok(fs.existsSync(path.join(root, 'attachments', 'opportunities')));
  assert.deepEqual(fs.readdirSync(root).sort(), ['attachments']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('read, save and remove only accept files two levels under attachments/opportunities', () => {
  const root = temp();
  fs.mkdirSync(path.join(root, 'attachments/orders'), { recursive: true });
  fs.writeFileSync(path.join(root, 'attachments/orders/secret.txt'), 'order file');
  fs.writeFileSync(path.join(root, 'attachments/top.txt'), 'top');
  const files = createOpportunityFiles({ attachmentsDir: path.join(root, 'attachments'), downloadsDir: path.join(root, 'dl') });
  const bad = ['/attachments/orders/secret.txt', '/attachments/opportunities/../orders/secret.txt', '/attachments/opportunities/%2e%2e/orders/secret.txt', '/attachments/opportunities/..%2Ftop.txt', '/attachments/opportunities/a/b/c.txt', '/attachments/opportunities/a', '/attachments/opportunities/', '/etc/passwd', 'http://x/attachments/opportunities/a/b.txt', '/attachments/opportunities/a/b.txt?x=1', '/attachments/opportunities/%zz/b.txt', '', null, undefined];
  for (const url of bad) {
    assert.equal(code(() => files.read(url)), 'invalid_input', String(url));
    assert.equal(code(() => files.saveCopy({ fileUrl: url, name: 'x' })), 'invalid_input', String(url));
    assert.equal(code(() => files.remove([url])), 'invalid_input', String(url));
  }
  assert.equal(fs.readFileSync(path.join(root, 'attachments/orders/secret.txt'), 'utf8'), 'order file');
  assert.equal(fs.readFileSync(path.join(root, 'attachments/top.txt'), 'utf8'), 'top');
  fs.rmSync(root, { recursive: true, force: true });
});

test('over the real local server: upload, preview, save a copy, back up with the state, delete', async () => {
  const temporary = temp();
  const resources = path.join(temporary, 'resources'); fs.mkdirSync(resources);
  for (const file of ['server.js', 'storage.js', 'storage-path.js', 'auth.js', 'errors.js', 'mail-account.js', 'mail-imap.js', 'mail-client.js', 'mail-smtp.js', 'mail-mime.js', 'mail-service.js', 'mail-libs.js', 'opportunity-files.js']) fs.copyFileSync(path.join(__dirname, '../backend', file), path.join(resources, file));
  fs.writeFileSync(path.join(resources, 'trade-order-system.html'), '<!doctype html><title>fixture</title>');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const token = crypto.randomBytes(32).toString('hex'), base = `http://127.0.0.1:${port}`, data = path.join(temporary, 'data');
  const child = spawn(process.execPath, [path.join(resources, 'server.js')], { env: { ...process.env, LAI_DATA_DIR: data, LAI_APP_PORT: String(port), LAI_API_TOKEN: token, LAI_APP_NO_OPEN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  const stop = () => child.exitCode !== null ? null : new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  const request = (route, options = {}) => fetch(base + route, { ...options, headers: { 'x-trade-token': token, ...options.headers } });
  const upload = (id, name, body, headers = {}) => request(`/api/opportunity-file/upload?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body });
  const post = (route, body) => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 20)); }
    // 需要登录会话、同源，类型要对。
    assert.equal((await fetch(base + '/api/opportunity-file/upload?id=o&name=a.txt', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'x' })).status, 401);
    assert.equal((await upload('o', 'a.txt', 'x', { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await upload('o', 'a.txt', 'x', { 'Content-Type': 'application/json' })).status, 415);
    assert.equal((await request('/api/opportunity-file/upload', { method: 'GET' })).status, 404);
    assert.equal((await request('/api/opportunity-file')).status, 400);

    const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
    const made = await (await upload('opp-77', '样品图.png', png)).json();
    assert.equal(made.ok, true); assert.equal(made.file.size, png.length);
    const shown = await request('/api/opportunity-file?url=' + encodeURIComponent(made.file.fileUrl));
    assert.equal(shown.status, 200); assert.equal(shown.headers.get('content-type'), 'image/png'); assert.match(shown.headers.get('content-disposition'), /^inline/); assert.equal(shown.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await shown.arrayBuffer()), png);
    assert.equal((await request('/api/opportunity-file?url=' + encodeURIComponent(made.file.fileUrl), { headers: { 'x-trade-token': 'wrong' } })).status, 401);

    const blocked = await upload('opp-77', 'x.exe', 'MZ'); assert.equal(blocked.status, 400); assert.equal((await blocked.json()).code, 'blocked_type');
    assert.equal((await upload('opp-77', 'empty.txt', '')).status, 400);
    const huge = await upload('opp-77', 'huge.txt', Buffer.alloc(MAX_BYTES + 1)); assert.equal(huge.status, 413); assert.equal((await huge.json()).code, 'too_large');
    assert.equal((await upload('opp-77', 'edge.txt', Buffer.alloc(MAX_BYTES, 65))).status, 200);

    const saved = await (await post('/api/opportunity-file/save', { fileUrl: made.file.fileUrl, name: '样品图.png' })).json();
    assert.equal(saved.ok, true); assert.deepEqual(fs.readFileSync(path.join(data, 'downloads', '样品图.png')), png);

    // 商机里只存元数据；备份时随数据一起复制文件。
    const snapshot = await (await request('/api/data')).json();
    const next = { ...snapshot, data: { ...snapshot.data, laiOpportunities: [{ id: 'opp-77', name: 'N', attachments: [{ id: 'att-1', name: '样品图.png', size: png.length, type: 'image/png', fileUrl: made.file.fileUrl, uploadedAt: '2026-10-07T00:00:00.000Z' }] }] } };
    const stored = await post('/api/save', { state: next, baseRevision: snapshot.revision });
    assert.equal(stored.status, 200);
    const backup = await (await post('/api/manual-backup', {})).json();
    assert.equal(backup.ok, true);
    assert.ok(backup.attachmentCount >= 1);
    const copied = path.join(backup.attachmentsDir, decodeURIComponent(made.file.fileUrl.slice('/attachments/'.length)));
    assert.deepEqual(fs.readFileSync(copied), png);

    // 一个附件的文件不见了：备份照常完成，只是不带这个文件，并报告缺了几个。
    const lone = await (await upload('opp-77', 'lost.txt', 'gone soon')).json();
    const withLost = { ...next, data: { ...next.data, laiOpportunities: [{ id: 'opp-77', name: 'N', attachments: [...next.data.laiOpportunities[0].attachments, { id: 'att-2', name: 'lost.txt', size: 9, type: 'text/plain', fileUrl: lone.file.fileUrl, uploadedAt: '2026-10-07T00:00:00.000Z' }] }] } };
    const latest = await (await request('/api/data')).json();
    assert.equal((await post('/api/save', { state: withLost, baseRevision: latest.revision })).status, 200);
    fs.rmSync(path.join(data, 'attachments', decodeURIComponent(lone.file.fileUrl.slice('/attachments/'.length))));
    const partial = await (await post('/api/manual-backup', {})).json();
    assert.equal(partial.ok, true); assert.equal(partial.missingAttachments, 1);
    assert.equal(fs.existsSync(path.join(partial.attachmentsDir, decodeURIComponent(lone.file.fileUrl.slice('/attachments/'.length)))), false);
    assert.deepEqual(fs.readFileSync(path.join(partial.attachmentsDir, decodeURIComponent(made.file.fileUrl.slice('/attachments/'.length)))), png);

    const removed = await (await post('/api/opportunity-file/delete', { fileUrls: [made.file.fileUrl] })).json();
    assert.deepEqual(removed, { ok: true, removed: 1 });
    assert.equal((await request('/api/opportunity-file?url=' + encodeURIComponent(made.file.fileUrl))).status, 404);
    assert.equal((await post('/api/opportunity-file/delete', { fileUrls: ['/attachments/orders/x.txt'] })).status, 400);
  } finally { await stop(); fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('symbolic links cannot lead reads, copies or deletes outside the opportunities folder', () => {
  const root = temp(), outside = path.join(root, 'outside');
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  const files = createOpportunityFiles({ attachmentsDir: path.join(root, 'attachments'), downloadsDir: path.join(root, 'dl') });
  const up = files.upload({ id: 'A', name: 'ok.txt', body: Buffer.from('ok') }).file.fileUrl;
  const folder = path.join(root, 'attachments/opportunities');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(folder, 'A', 'link.txt'));
  fs.symlinkSync(outside, path.join(folder, 'L'));
  for (const url of ['/attachments/opportunities/A/link.txt', '/attachments/opportunities/L/secret.txt']) {
    assert.equal(code(() => files.read(url)), 'invalid_input', url);
    assert.equal(code(() => files.saveCopy({ fileUrl: url, name: 'x' })), 'invalid_input', url);
    assert.equal(code(() => files.remove([url])), 'invalid_input', url);
  }
  assert.equal(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'secret');
  assert.equal(files.read(up).body.toString(), 'ok');
  fs.rmSync(root, { recursive: true, force: true });
});
