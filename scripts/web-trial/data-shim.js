/* 来财Lai 网页试用版：数据替身。网页里没有本机数据服务，这里用浏览器本地存储（localStorage）模拟它的数据接口：
   /api/data（读）、/api/save（存，带版本号检查）、/api/import-log、/api/manual-backup、/api/open-data-folder、/api/health。
   接口形状对照 backend/server.js 和 backend/storage.js。邮件接口由 mail-demo.js 负责（它放在本文件之后）。
   同时提供 window.LaiWebTrial（stats / persistent / snapshot / restore / clear），给「测试数据」面板和 scripts/ui-audit 用。
   发布试用版时本文件作为第一个 <script>，放在所有业务模块之后、应用主脚本之前；由 scripts/web-trial/build.py 自动放置。
   存不下（隐私模式、被禁用、超出容量）时数据只留在当前页面里，刷新就没了，面板里会提示。 */
(function (root) {
  'use strict';
  var KEY = 'lai-web-trial-v1', FLAG = 'lai-web-trial-demo-seeded', LOG_KEY = 'lai-web-trial-import-logs';
  var memory = null, memoryLogs = {}, storageOk = null;

  function store() {
    try { return root.localStorage; } catch (error) { return null; }
  }
  function probe() {
    if (storageOk !== null) return storageOk;
    try {
      var s = store();
      s.setItem('lai-web-trial-probe', '1'); s.removeItem('lai-web-trial-probe');
      storageOk = true;
    } catch (error) { storageOk = false; }
    return storageOk;
  }
  function json(status, body) {
    return new Response(JSON.stringify(body), {status: status, headers: {'Content-Type': 'application/json'}});
  }
  function empty() {
    return {
      app: 'trade-order-system', version: 'sqlite-1', exportedAt: new Date().toISOString(), revision: 1,
      data: {orders: [], trashOrders: [], deletedOrders: [], customers: {}, trackingLookups: []}
    };
  }
  // 和 backend/storage.js 的 normalizeDataPayload 一样：接受带外壳的备份，或者只有数据的备份。
  function normalize(raw) {
    var wrapper = raw && raw.data && Array.isArray(raw.data.orders) ? raw : {data: raw};
    var data = wrapper.data;
    if (!data || !Array.isArray(data.orders)) throw new Error('备份内容不完整：缺少订单列表');
    ['trashOrders', 'deletedOrders', 'trackingLookups'].forEach(function (key) { if (!Array.isArray(data[key])) data[key] = []; });
    if (!data.customers || typeof data.customers !== 'object' || Array.isArray(data.customers)) data.customers = {};
    return {
      app: String(wrapper.app || 'trade-order-system'), version: String(wrapper.version || 'sqlite-1'),
      exportedAt: String(wrapper.exportedAt || new Date().toISOString()), revision: Number(wrapper.revision) || 1, data: data
    };
  }
  function read() {
    if (probe()) {
      try {
        var text = store().getItem(KEY);
        if (text) return normalize(JSON.parse(text));
      } catch (error) { /* 存的内容坏了：当作没有 */ }
      return null;
    }
    return memory;
  }
  function current() {
    var found = read();
    if (found) return found;
    // 浏览器存不了数据时，第一次打开也要有示例数据（能存时由 demo-seed.js 在页面载入时写入）。
    if (!probe() && root.LaiWebTrialDemoSeed) {
      try { memory = normalize(root.LaiWebTrialDemoSeed.build(new Date())); return memory; } catch (error) { /* 用空数据 */ }
    }
    return empty();
  }
  function write(payload) {
    memory = payload;
    if (!probe()) return;
    store().setItem(KEY, JSON.stringify(payload));
  }
  function readLogs() {
    if (!probe()) return memoryLogs;
    try { return JSON.parse(store().getItem(LOG_KEY) || '{}') || {}; } catch (error) { return {}; }
  }
  function writeLogs(logs) {
    memoryLogs = logs;
    if (probe()) { try { store().setItem(LOG_KEY, JSON.stringify(logs)); } catch (error) { /* 导入记录存不下就算了 */ } }
  }
  function counts(payload) {
    return {customers: Object.keys(payload.data.customers || {}).length, orders: payload.data.orders.length};
  }

  function save(body) {
    var state = body && body.state && typeof body.state === 'object' ? body.state : body;
    var base = body && body.baseRevision !== undefined ? body.baseRevision : state && state.baseRevision;
    var now = current();
    if (base === undefined || base === null) return json(428, {ok: false, message: '缺少版本号', currentRevision: now.revision});
    if (Number(base) !== now.revision) return json(409, {ok: false, message: '数据已发生变化，请刷新页面后再编辑。', currentRevision: now.revision});
    var next;
    try { next = normalize(state); } catch (error) { return json(400, {ok: false, message: error.message}); }
    next.app = now.app; next.version = now.version; next.exportedAt = new Date().toISOString(); next.revision = now.revision + 1;
    try { write(next); }
    catch (error) {
      memory = null;
      return json(507, {ok: false, message: '浏览器存不下这么多数据（通常上限约 5MB）。请先删除一些数据，或到设置中心的「测试数据」里复制备份后清空。'});
    }
    if (body.importLog && body.importLog.id) {
      var logs = readLogs();
      logs[String(body.importLog.id)] = Array.isArray(body.importLog.issues) ? body.importLog.issues : [];
      writeLogs(logs);
    }
    return json(200, {ok: true, storageMode: 'browser', revision: next.revision, counts: counts(next), backup: {ok: true}});
  }

  var inner = root.fetch;
  root.fetch = function (input, init) {
    var url = String(typeof input === 'string' ? input : (input && input.url) || '');
    var match = /^(?:https?:\/\/[^\/]+)?(\/api\/(?:data|save|save-changes|import-log|manual-backup|open-data-folder|health))(?:\?([^#]*))?$/.exec(url);
    if (!match) return inner.apply(root, arguments);
    var method = String(init && init.method || (input && input.method) || 'GET').toUpperCase(), path = match[1];
    try {
      if (path === '/api/data' && method === 'GET') return Promise.resolve(json(200, current()));
      if (path === '/api/health') return Promise.resolve(json(200, {ok: true, storageMode: 'browser', storageRevision: current().revision}));
      if (path === '/api/import-log' && method === 'GET') {
        var id = new URLSearchParams(match[2] || '').get('id') || '';
        return Promise.resolve(json(200, {ok: true, issues: readLogs()[id] || []}));
      }
      if (path === '/api/save' && method === 'POST') {
        var body;
        try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (error) { return Promise.resolve(json(400, {ok: false, message: '请求内容无效'})); }
        return Promise.resolve(save(body));
      }
      if (path === '/api/manual-backup' && method === 'POST') return Promise.resolve(json(501, {ok: false, message: '网页试用版不能保存文件。请到设置中心的「测试数据」里复制备份。'}));
      if (path === '/api/open-data-folder' && method === 'POST') return Promise.resolve(json(501, {ok: false, message: '网页试用版没有数据文件夹，数据保存在这个浏览器里。'}));
    } catch (error) {
      return Promise.resolve(json(500, {ok: false, message: '试用版数据出错：' + error.message}));
    }
    return Promise.resolve(json(404, {ok: false, message: 'not found'}));
  };

  root.LaiWebTrial = {
    stats: function () { return counts(current()); },
    persistent: function () { return probe(); },
    snapshot: function () { return JSON.stringify(current()); },
    // 恢复备份：版本号取比现在大的，已经打开的页面再保存时会提示数据已变化，刷新即可。
    restore: function (text) {
      var parsed;
      try { parsed = JSON.parse(String(text || '').trim()); } catch (error) { throw new Error('备份内容不是有效的数据，请完整复制后再粘贴。'); }
      var next = normalize(parsed);
      next.revision = current().revision + 1;
      write(next);
      if (probe()) { try { store().setItem(FLAG, '1'); } catch (error) { /* 无所谓 */ } }
    },
    clear: function () {
      var next = empty();
      next.revision = current().revision + 1;
      write(next);
      writeLogs({});
      if (probe()) { try { store().setItem(FLAG, '1'); } catch (error) { /* 无所谓 */ } }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
