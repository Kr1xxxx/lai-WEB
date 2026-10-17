const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { laiDataDirectory } = require('./storage-path.js');
const { httpError } = require('./errors.js');

// Keep the existing schema and payload format. Legacy records are historical data,
// not enabled integration services. No migrations delete or rewrite user records.
function openStorage({ seedFile }) {
  const seedDataFile = seedFile;
  // 启动时把整个数据目录查一遍（有没有符号链接、硬链接）；之后每次保存只查路径本身。
  const supportDir = laiDataDirectory({ scan: true });
  const backupDir = path.join(supportDir, 'backups');
  const attachmentsDir = path.join(supportDir, 'attachments');
  const dataFile = path.join(supportDir, 'lai-data.json');
  const databaseFile = path.join(supportDir, 'lai-data.sqlite');
  const migrationArchiveDir = path.join(supportDir, 'migration-archive');
  const backupMetaFile = path.join(supportDir, 'backup-meta.json');
  const storageMarkerFile = path.join(supportDir, 'sqlite-storage.json');
  let database = null;
  let storageMode = 'initializing';
  let storageError = '';
  let storageRevision = 0;
  let startupIntegrity = { ok: false, message: 'not checked' };

  function ensureStorage() {
    laiDataDirectory({ scan: false });
    fs.mkdirSync(backupDir, { recursive: true });
    fs.mkdirSync(attachmentsDir, { recursive: true });
    fs.mkdirSync(migrationArchiveDir, { recursive: true });
    [supportDir, backupDir, attachmentsDir, migrationArchiveDir].forEach(dir => {
      try { fs.chmodSync(dir, 0o700); } catch (_) {}
    });
  }

  function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function atomicWrite(file, text) {
    const tmp = path.join(
      path.dirname(file),
      `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    let descriptor;
    try {
      descriptor = fs.openSync(tmp, 'wx', 0o600);
      fs.writeFileSync(descriptor, text);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(tmp, file);
      fs.chmodSync(file, 0o600);
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch (_) {}
      }
      try { fs.rmSync(tmp, { force: true }); } catch (_) {}
      throw error;
    }
  }

  function timestamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  const orderBuckets = ['orders', 'trashOrders', 'deletedOrders'];
  const entityStateKeys = new Set([...orderBuckets, 'customers', 'trackingLookups']);

  function emptyDataPayload() {
    return {
      app: 'trade-order-system',
      version: 'sqlite-1',
      exportedAt: new Date().toISOString(),
      data: {
        orders: [],
        trashOrders: [],
        deletedOrders: [],
        customers: {},
        trackingLookups: []
      }
    };
  }

  function normalizeDataPayload(raw) {
    const wrapper = raw && raw.data && Array.isArray(raw.data.orders)
      ? raw
      : { app: 'trade-order-system', version: 'legacy', exportedAt: new Date().toISOString(), data: raw };
    const data = wrapper?.data;
    if (!data || !Array.isArray(data.orders)) throw new Error('missing orders');
    orderBuckets.forEach(key => {
      if (!Array.isArray(data[key])) data[key] = [];
    });
    if (!data.customers || typeof data.customers !== 'object' || Array.isArray(data.customers)) data.customers = {};
    if (!Array.isArray(data.trackingLookups)) data.trackingLookups = [];
    return {
      app: String(wrapper.app || 'trade-order-system'),
      version: String(wrapper.version || 'sqlite-1'),
      exportedAt: String(wrapper.exportedAt || new Date().toISOString()),
      data
    };
  }

  function stateCounts(payload) {
    const data = normalizeDataPayload(payload).data;
    return {
      orders: data.orders.length,
      trashOrders: data.trashOrders.length,
      deletedOrders: data.deletedOrders.length,
      customers: Object.keys(data.customers).length,
      trackingLookups: data.trackingLookups.length
    };
  }

  function normalizeImportLog(importLog, data) {
    if (!importLog) return null;
    const id = String(importLog.id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
        || !Array.isArray(data.laiImportHistory)
        || data.laiImportHistory[0]?.id !== id
        || !Array.isArray(importLog.issues) || importLog.issues.length > 10000
        || importLog.issues.length !== Number(data.laiImportHistory[0]?.result?.skipped))
      throw httpError(400, 'invalid import log');
    const issues = importLog.issues.map(item => {
      const row = Number(item?.row), name = String(item?.name || ''), reason = String(item?.reason || '');
      if (!Number.isSafeInteger(row) || row < 2 || name.length > 200 || reason.length > 200)
        throw httpError(400, 'invalid import log row');
      return {row,name,reason};
    });
    return {id,issues};
  }

  function metadataValue(key, fallback = '') {
    if (!database) return fallback;
    const row = database.prepare('SELECT value FROM metadata WHERE key = ?').get(key);
    return row ? String(row.value) : fallback;
  }

  function setMetadata(key, value) {
    database.prepare(`
      INSERT INTO metadata(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(key), String(value));
  }

  function createDatabaseSchema() {
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        bucket TEXT NOT NULL CHECK(bucket IN ('orders','trashOrders','deletedOrders')),
        position INTEGER NOT NULL,
        num TEXT NOT NULL DEFAULT '',
        client TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        order_month TEXT NOT NULL DEFAULT '',
        stage TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL DEFAULT 0,
        paid_amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        tracking_number TEXT NOT NULL DEFAULT '',
        carrier TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_num ON orders(num) WHERE num <> '';
      CREATE INDEX IF NOT EXISTS idx_orders_bucket_position ON orders(bucket, position);
      CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client);
      CREATE INDEX IF NOT EXISTS idx_orders_month ON orders(order_month);
      CREATE INDEX IF NOT EXISTS idx_orders_stage ON orders(stage);
      CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_number);

      CREATE TABLE IF NOT EXISTS customers (
        name TEXT PRIMARY KEY,
        country TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
      CREATE INDEX IF NOT EXISTS idx_customers_contact ON customers(contact);

      CREATE TABLE IF NOT EXISTS tracking_lookups (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        tracking_number TEXT NOT NULL DEFAULT '',
        carrier TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tracking_number ON tracking_lookups(tracking_number);

      CREATE TABLE IF NOT EXISTS order_attachments (
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        file_url TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL,
        PRIMARY KEY(order_id, position)
      );

      CREATE TABLE IF NOT EXISTS order_logs (
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        event_time TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL,
        PRIMARY KEY(order_id, position)
      );

      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mail_account (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mail_bulk (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mail_drafts (
        id TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mail_draft_files (
        draft_id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mail_templates (
        id TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS import_logs (
        id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notification_deliveries (
        order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
        channel TEXT NOT NULL DEFAULT 'feishu_group',
        status TEXT NOT NULL CHECK(status IN ('sending','sent','failed')),
        idempotency_key TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT '',
        sent_at TEXT NOT NULL DEFAULT '',
        message_id TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
  }

  // 整包保存（/api/save）会用页面发来的数据替换全部数据。页面出错时发来的数据可能缺块：
  // 服务器已有的顶层字段（客户、订单、各模块设置）在新数据里缺了或类型不对，就整个拒绝，原数据不动。
  // 在写事务里读当前数据再比较，保证比较的就是即将被替换的那一份。迁移（首次建库）不做这个检查。
  function validateReplacement(raw, previous) {
    const data = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' ? raw.data : raw;
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const invalid = key => { throw httpError(400, '保存的内容不完整，原数据没有改动。请刷新页面后再试。', { code: 'incomplete_save', field: String(key).slice(0, 80) }); };
    if (!object(data)) invalid('data');
    if (!Array.isArray(data.orders)) invalid('orders');
    if (!object(data.customers)) invalid('customers');
    for (const key of ['trashOrders', 'deletedOrders', 'trackingLookups']) {
      if (Object.hasOwn(data, key) && !Array.isArray(data[key])) invalid(key);
    }
    for (const [name, customer] of Object.entries(data.customers)) if (!object(customer)) invalid(`customers.${name}`);
    for (const key of Object.keys(previous)) {
      if (!Object.hasOwn(data, key) || data[key] === undefined) invalid(key);
      if (Array.isArray(previous[key]) && !Array.isArray(data[key])) invalid(key);
      if (object(previous[key]) && !object(data[key])) invalid(key);
    }
  }

  function writeStateToDatabase(rawPayload, { migration = false, baseRevision, importLog } = {}) {
    if (!database) throw new Error('SQLite database is not available');
    const orderInsert = database.prepare(`
      INSERT INTO orders(
        id, bucket, position, num, client, country, order_month, stage,
        amount, paid_amount, currency, tracking_number, carrier, updated_at, data_json
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        bucket = excluded.bucket,
        position = excluded.position,
        num = excluded.num,
        client = excluded.client,
        country = excluded.country,
        order_month = excluded.order_month,
        stage = excluded.stage,
        amount = excluded.amount,
        paid_amount = excluded.paid_amount,
        currency = excluded.currency,
        tracking_number = excluded.tracking_number,
        carrier = excluded.carrier,
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
    `);
    const attachmentInsert = database.prepare(`
      INSERT INTO order_attachments(order_id, position, file_url, data_json) VALUES(?, ?, ?, ?)
    `);
    const logInsert = database.prepare(`
      INSERT INTO order_logs(order_id, position, event_time, data_json) VALUES(?, ?, ?, ?)
    `);
    const customerInsert = database.prepare(`
      INSERT INTO customers(name, country, email, contact, updated_at, data_json) VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        country = excluded.country,
        email = excluded.email,
        contact = excluded.contact,
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
    `);
    const lookupInsert = database.prepare(`
      INSERT INTO tracking_lookups(id, position, tracking_number, carrier, updated_at, data_json) VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        position = excluded.position,
        tracking_number = excluded.tracking_number,
        carrier = excluded.carrier,
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
    `);
    const appStateInsert = database.prepare(`
      INSERT INTO app_state(key, data_json) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json
    `);
    const attachmentDelete = database.prepare('DELETE FROM order_attachments WHERE order_id = ?');
    const logDelete = database.prepare('DELETE FROM order_logs WHERE order_id = ?');
    const orderDelete = database.prepare('DELETE FROM orders WHERE id = ?');
    const customerDelete = database.prepare('DELETE FROM customers WHERE name = ?');
    const lookupDelete = database.prepare('DELETE FROM tracking_lookups WHERE id = ?');
    const appStateGet = database.prepare('SELECT data_json FROM app_state WHERE key = ?');
    const appStateDelete = database.prepare('DELETE FROM app_state WHERE key = ?');

    database.exec('BEGIN IMMEDIATE');
    try {
      const currentRevision = Number(metadataValue('revision', '0'));
      if (!migration) {
        const requestedRevision = Number(baseRevision);
        if (!Number.isSafeInteger(requestedRevision) || requestedRevision < 0) {
          throw httpError(428, 'baseRevision is required', { currentRevision });
        }
        if (requestedRevision !== currentRevision) {
          throw httpError(409, 'state revision conflict', { currentRevision });
        }
        validateReplacement(rawPayload, readStateFromDatabase().data);
      }
      // normalizeDataPayload 会补空字段，所以先做上面的检查，再处理一份拷贝。
      const payload = normalizeDataPayload(structuredClone(rawPayload));
      const data = payload.data;
      const validatedImportLog = normalizeImportLog(importLog, data);
      const nextRevision = currentRevision + 1;
      const existingOrders = new Map(database.prepare('SELECT id, bucket, position, data_json FROM orders').all().map(row => [row.id, row]));
      const desiredOrderIds = new Set();
      orderBuckets.forEach(bucket => {
        data[bucket].forEach((order, position) => {
          const id = String(order?.id || '').trim();
          if (!id) throw new Error(`${bucket} contains an order without id`);
          if (desiredOrderIds.has(id)) throw new Error(`duplicate order id: ${id}`);
          desiredOrderIds.add(id);
          const orderJson = JSON.stringify(order);
          const previous = existingOrders.get(id);
          const changed = !previous || previous.data_json !== orderJson || previous.bucket !== bucket || Number(previous.position) !== position;
          if (changed) {
            orderInsert.run(
              id,
              bucket,
              position,
              String(order.num || ''),
              String(order.client || ''),
              String(order.country || ''),
              String(order.orderMonth || ''),
              String(order.stage || ''),
              Number(order.amount || 0),
              Number(order.paidAmount || 0),
              String(order.currency || 'USD'),
              String(order.trackingNumber || ''),
              String(order.carrier || ''),
              String(order.updated || ''),
              orderJson
            );
          }
          if (!previous || previous.data_json !== orderJson) {
            attachmentDelete.run(id);
            logDelete.run(id);
            (Array.isArray(order.attachments) ? order.attachments : []).forEach((item, index) => {
              attachmentInsert.run(id, index, String(item?.fileUrl || item?.link || ''), JSON.stringify(item));
            });
            (Array.isArray(order.logs) ? order.logs : []).forEach((item, index) => {
              const eventTime = typeof item === 'object' && item ? item.time : '';
              logInsert.run(id, index, String(eventTime || ''), JSON.stringify(item));
            });
          }
        });
      });
      existingOrders.forEach((_, id) => {
        if (!desiredOrderIds.has(id)) orderDelete.run(id);
      });

      const existingCustomers = new Map(database.prepare('SELECT name, data_json FROM customers').all().map(row => [row.name, row.data_json]));
      const desiredCustomerNames = new Set();
      Object.entries(data.customers).forEach(([name, customer]) => {
        const record = customer && typeof customer === 'object' ? customer : {};
        const cleanName = String(name);
        const customerJson = JSON.stringify(record);
        desiredCustomerNames.add(cleanName);
        if (existingCustomers.get(cleanName) !== customerJson) {
          customerInsert.run(
            cleanName,
            String(record.country || ''),
            String(record.email || ''),
            String(record.contact || ''),
            String(record.updated || ''),
            customerJson
          );
        }
      });
      existingCustomers.forEach((_, name) => {
        if (!desiredCustomerNames.has(name)) customerDelete.run(name);
      });

      const existingLookups = new Map(database.prepare('SELECT id, position, data_json FROM tracking_lookups').all().map(row => [row.id, row]));
      const desiredLookupIds = new Set();
      data.trackingLookups.forEach((item, position) => {
        const id = String(item?.id || `lookup-${position}-${item?.trackingNumber || ''}`);
        const lookupJson = JSON.stringify(item || {});
        if (desiredLookupIds.has(id)) throw new Error(`duplicate tracking lookup id: ${id}`);
        desiredLookupIds.add(id);
        const previous = existingLookups.get(id);
        if (!previous || previous.data_json !== lookupJson || Number(previous.position) !== position) {
          lookupInsert.run(
            id,
            position,
            String(item?.trackingNumber || ''),
            String(item?.carrier || ''),
            String(item?.checkedAt || item?.updated || ''),
            lookupJson
          );
        }
      });
      existingLookups.forEach((_, id) => {
        if (!desiredLookupIds.has(id)) lookupDelete.run(id);
      });

      const desiredAppStateKeys = new Set();
      Object.entries(data).forEach(([key, value]) => {
        if (entityStateKeys.has(key)) return;
        desiredAppStateKeys.add(key);
        const nextJson = JSON.stringify(value);
        const existing = appStateGet.get(key);
        if (!existing || existing.data_json !== nextJson) appStateInsert.run(key, nextJson);
      });
      database.prepare('SELECT key FROM app_state').all().forEach(row => {
        if (!desiredAppStateKeys.has(row.key)) appStateDelete.run(row.key);
      });
      if (validatedImportLog) database.prepare('INSERT INTO import_logs(id, data_json) VALUES(?, ?)')
        .run(validatedImportLog.id, JSON.stringify(validatedImportLog.issues));
      setMetadata('schema_version', '1');
      setMetadata('app', payload.app);
      setMetadata('payload_version', payload.version);
      setMetadata('exported_at', payload.exportedAt);
      setMetadata('revision', String(nextRevision));
      setMetadata('last_saved_at', new Date().toISOString());
      // 业务数据有新改动、还没进备份：备份队列看这个记号（存在数据库里，异常退出后也不会丢）。
      setMetadata('business_backup_revision', migration ? '0' : String(nextRevision));
      if (migration) setMetadata('migrated_at', new Date().toISOString());

      const expected = stateCounts(payload);
      const actual = {
        orders: Number(database.prepare("SELECT COUNT(*) AS count FROM orders WHERE bucket = 'orders'").get().count),
        trashOrders: Number(database.prepare("SELECT COUNT(*) AS count FROM orders WHERE bucket = 'trashOrders'").get().count),
        deletedOrders: Number(database.prepare("SELECT COUNT(*) AS count FROM orders WHERE bucket = 'deletedOrders'").get().count),
        customers: Number(database.prepare('SELECT COUNT(*) AS count FROM customers').get().count),
        trackingLookups: Number(database.prepare('SELECT COUNT(*) AS count FROM tracking_lookups').get().count)
      };
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        throw new Error(`SQLite verification failed: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
      }
      database.exec('COMMIT');
      storageRevision = nextRevision;
      if (!migration) queueBackup();
      return { revision: nextRevision, counts: actual };
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  // 只保存改动：客户端只发改过的客户/订单和其它整块设置，服务器在一个事务里按版本号套用，
  // 最后核对各表条数和客户端的是否一致，不一致就整个撤销（客户端会改走整包保存）。
  // changes = { customers:{set:{name:obj},remove:[name]}, orders:{set:{id:{bucket,order}},remove:[id],sequence:{bucket:[id]}},
  //             trackingLookups:[...]|undefined, appState:{key:value}, removeAppState:[key], counts:{...} }
  function applyChanges(changes, { baseRevision, importLog } = {}) {
    if (!database) throw new Error('SQLite database is not available');
    const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
    if (!isObject(changes)) throw httpError(400, 'changes are required');
    const customerSet = isObject(changes.customers?.set) ? changes.customers.set : {};
    const customerRemove = Array.isArray(changes.customers?.remove) ? changes.customers.remove.map(String) : [];
    const orderSet = isObject(changes.orders?.set) ? changes.orders.set : {};
    const orderRemove = Array.isArray(changes.orders?.remove) ? changes.orders.remove.map(String) : [];
    const sequence = isObject(changes.orders?.sequence) ? changes.orders.sequence : {};
    const appSet = isObject(changes.appState) ? changes.appState : {};
    const appRemove = Array.isArray(changes.removeAppState) ? changes.removeAppState.map(String) : [];
    if (Object.keys(appSet).some(key => entityStateKeys.has(key))) throw httpError(400, 'appState cannot carry orders or customers');
    if (Object.keys(sequence).some(bucket => !orderBuckets.includes(bucket))) throw httpError(400, 'unknown order bucket');
    if (changes.trackingLookups !== undefined && !Array.isArray(changes.trackingLookups)) throw httpError(400, 'trackingLookups must be a list');
    const validatedImportLog = normalizeImportLog(importLog, { laiImportHistory: appSet.laiImportHistory });
    const orderUpsert = database.prepare(`
      INSERT INTO orders(
        id, bucket, position, num, client, country, order_month, stage,
        amount, paid_amount, currency, tracking_number, carrier, updated_at, data_json
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        bucket = excluded.bucket, position = excluded.position, num = excluded.num, client = excluded.client,
        country = excluded.country, order_month = excluded.order_month, stage = excluded.stage, amount = excluded.amount,
        paid_amount = excluded.paid_amount, currency = excluded.currency, tracking_number = excluded.tracking_number,
        carrier = excluded.carrier, updated_at = excluded.updated_at, data_json = excluded.data_json
    `);
    const attachmentInsert = database.prepare('INSERT INTO order_attachments(order_id, position, file_url, data_json) VALUES(?, ?, ?, ?)');
    const logInsert = database.prepare('INSERT INTO order_logs(order_id, position, event_time, data_json) VALUES(?, ?, ?, ?)');
    const customerUpsert = database.prepare(`
      INSERT INTO customers(name, country, email, contact, updated_at, data_json) VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET country = excluded.country, email = excluded.email, contact = excluded.contact,
        updated_at = excluded.updated_at, data_json = excluded.data_json
    `);
    const appStateInsert = database.prepare(`
      INSERT INTO app_state(key, data_json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json
    `);
    database.exec('BEGIN IMMEDIATE');
    try {
      const currentRevision = Number(metadataValue('revision', '0'));
      const requestedRevision = Number(baseRevision);
      if (!Number.isSafeInteger(requestedRevision) || requestedRevision < 0) throw httpError(428, 'baseRevision is required', { currentRevision });
      if (requestedRevision !== currentRevision) throw httpError(409, 'state revision conflict', { currentRevision });
      const nextRevision = currentRevision + 1;

      for (const id of orderRemove) {
        database.prepare('DELETE FROM order_attachments WHERE order_id = ?').run(id);
        database.prepare('DELETE FROM order_logs WHERE order_id = ?').run(id);
        database.prepare('DELETE FROM orders WHERE id = ?').run(id);
      }
      // Positions: a bucket's full id list is only sent when its order changed, so rows keep their old position otherwise.
      const positions = new Map();
      for (const [bucket, ids] of Object.entries(sequence)) {
        if (!Array.isArray(ids)) throw httpError(400, 'order sequence must be a list');
        ids.forEach((rawId, position) => {
          const id = String(rawId);
          if (positions.has(id)) throw new Error(`duplicate order id: ${id}`);
          positions.set(id, { bucket, position });
        });
      }
      const existingPosition = database.prepare('SELECT bucket, position FROM orders WHERE id = ?');
      const move = database.prepare('UPDATE orders SET bucket = ?, position = ? WHERE id = ?');
      for (const [id, entry] of Object.entries(orderSet)) {
        const order = entry?.order;
        if (!isObject(order) || String(order.id || '').trim() !== id) throw new Error('order without matching id');
        const where = positions.get(id) || existingPosition.get(id);
        const bucket = String(entry.bucket || where?.bucket || '');
        if (!orderBuckets.includes(bucket)) throw httpError(400, 'unknown order bucket');
        const position = positions.get(id)?.position ?? (existingPosition.get(id)?.bucket === bucket ? existingPosition.get(id).position : Number(database.prepare('SELECT COUNT(*) AS count FROM orders WHERE bucket = ?').get(bucket).count));
        if (positions.has(id) && positions.get(id).bucket !== bucket) throw new Error(`order ${id} bucket does not match its sequence`);
        orderUpsert.run(
          id, bucket, position, String(order.num || ''), String(order.client || ''), String(order.country || ''),
          String(order.orderMonth || ''), String(order.stage || ''), Number(order.amount || 0), Number(order.paidAmount || 0),
          String(order.currency || 'USD'), String(order.trackingNumber || ''), String(order.carrier || ''), String(order.updated || ''),
          JSON.stringify(order)
        );
        database.prepare('DELETE FROM order_attachments WHERE order_id = ?').run(id);
        database.prepare('DELETE FROM order_logs WHERE order_id = ?').run(id);
        (Array.isArray(order.attachments) ? order.attachments : []).forEach((item, index) => {
          attachmentInsert.run(id, index, String(item?.fileUrl || item?.link || ''), JSON.stringify(item));
        });
        (Array.isArray(order.logs) ? order.logs : []).forEach((item, index) => {
          const eventTime = typeof item === 'object' && item ? item.time : '';
          logInsert.run(id, index, String(eventTime || ''), JSON.stringify(item));
        });
      }
      for (const [id, where] of positions) {
        if (orderSet[id]) continue;
        const row = existingPosition.get(id);
        if (!row) throw new Error(`sequence names an unknown order: ${id}`);
        if (row.bucket !== where.bucket || Number(row.position) !== where.position) move.run(where.bucket, where.position, id);
      }

      for (const name of customerRemove) database.prepare('DELETE FROM customers WHERE name = ?').run(name);
      for (const [name, customer] of Object.entries(customerSet)) {
        const record = isObject(customer) ? customer : {};
        customerUpsert.run(String(name), String(record.country || ''), String(record.email || ''), String(record.contact || ''), String(record.updated || ''), JSON.stringify(record));
      }

      if (changes.trackingLookups !== undefined) {
        const ids = new Set();
        database.prepare('DELETE FROM tracking_lookups').run();
        const lookupInsert = database.prepare(`
          INSERT INTO tracking_lookups(id, position, tracking_number, carrier, updated_at, data_json) VALUES(?, ?, ?, ?, ?, ?)
        `);
        changes.trackingLookups.forEach((item, position) => {
          const id = String(item?.id || `lookup-${position}-${item?.trackingNumber || ''}`);
          if (ids.has(id)) throw new Error(`duplicate tracking lookup id: ${id}`);
          ids.add(id);
          lookupInsert.run(id, position, String(item?.trackingNumber || ''), String(item?.carrier || ''), String(item?.checkedAt || item?.updated || ''), JSON.stringify(item || {}));
        });
      }
      for (const [key, value] of Object.entries(appSet)) appStateInsert.run(key, JSON.stringify(value));
      for (const key of appRemove) database.prepare('DELETE FROM app_state WHERE key = ?').run(key);
      if (validatedImportLog) database.prepare('INSERT INTO import_logs(id, data_json) VALUES(?, ?)')
        .run(validatedImportLog.id, JSON.stringify(validatedImportLog.issues));
      setMetadata('revision', String(nextRevision));
      setMetadata('last_saved_at', new Date().toISOString());
      setMetadata('business_backup_revision', String(nextRevision));

      const count = sql => Number(database.prepare(sql).get().count);
      const actual = {
        orders: count("SELECT COUNT(*) AS count FROM orders WHERE bucket = 'orders'"),
        trashOrders: count("SELECT COUNT(*) AS count FROM orders WHERE bucket = 'trashOrders'"),
        deletedOrders: count("SELECT COUNT(*) AS count FROM orders WHERE bucket = 'deletedOrders'"),
        customers: count('SELECT COUNT(*) AS count FROM customers'),
        trackingLookups: count('SELECT COUNT(*) AS count FROM tracking_lookups')
      };
      const expected = changes.counts;
      if (!isObject(expected) || JSON.stringify(expected) !== JSON.stringify(actual)) {
        throw httpError(422, `change verification failed: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`, { currentRevision });
      }
      // Positions inside each bucket must be exactly 0..n-1, otherwise the list would come back reordered.
      for (const bucket of orderBuckets) {
        const stats = database.prepare('SELECT COUNT(*) AS count, COUNT(DISTINCT position) AS distinctCount, COALESCE(MAX(position), -1) AS maxPosition FROM orders WHERE bucket = ?').get(bucket);
        if (Number(stats.count) !== Number(stats.distinctCount) || Number(stats.maxPosition) !== Number(stats.count) - 1)
          throw httpError(422, `change verification failed: ${bucket} positions are not 0..n-1`, { currentRevision });
      }
      database.exec('COMMIT');
      storageRevision = nextRevision;
      queueBackup();
      return { revision: nextRevision, counts: actual };
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  function readStateFromDatabase() {
    if (!database) throw new Error('SQLite database is not available');
    const data = Object.create(null);
    database.prepare('SELECT key, data_json FROM app_state').all().forEach(row => {
      data[row.key] = JSON.parse(row.data_json);
    });
    orderBuckets.forEach(bucket => { data[bucket] = []; });
    database.prepare(`
      SELECT bucket, data_json FROM orders
      ORDER BY CASE bucket WHEN 'orders' THEN 0 WHEN 'trashOrders' THEN 1 ELSE 2 END, position
    `).all().forEach(row => {
      data[row.bucket].push(JSON.parse(row.data_json));
    });
    data.customers = Object.create(null);
    database.prepare('SELECT name, data_json FROM customers ORDER BY name').all().forEach(row => {
      data.customers[row.name] = JSON.parse(row.data_json);
    });
    data.trackingLookups = database.prepare('SELECT data_json FROM tracking_lookups ORDER BY position').all().map(row => JSON.parse(row.data_json));
    const deliveryByOrder = new Map(database.prepare(`
      SELECT order_id, status, sent_at, message_id, last_error, updated_at
      FROM notification_deliveries
    `).all().map(row => [row.order_id, row]));
    orderBuckets.forEach(bucket => {
      data[bucket] = data[bucket].map(order => {
        const delivery = deliveryByOrder.get(order.id);
        if (!delivery) return order;
        return {
          ...order,
          feishuNotification: {
            ...order.feishuNotification,
            requested: true,
            status: delivery.status,
            chatName: order.feishuNotification?.chatName || '',
            sentAt: delivery.sent_at || '',
            messageId: delivery.message_id || '',
            error: delivery.last_error || '',
            updatedAt: delivery.updated_at || ''
          }
        };
      });
    });
    return {
      app: metadataValue('app', 'trade-order-system'),
      version: metadataValue('payload_version', 'sqlite-1'),
      exportedAt: metadataValue('exported_at', new Date().toISOString()),
      data
    };
  }

  function databaseIntegrity() {
    if (!database) return { ok: false, message: storageError || 'SQLite unavailable' };
    const result = database.prepare('PRAGMA integrity_check').get();
    const message = String(result?.integrity_check || 'unknown');
    return { ok: message === 'ok', message };
  }

  function archiveMigrationSource(sourceFile) {
    if (!sourceFile || !fs.existsSync(sourceFile)) return '';
    const target = path.join(migrationArchiveDir, `lai-data-before-sqlite-${timestamp()}.json`);
    fs.copyFileSync(sourceFile, target);
    try { fs.chmodSync(target, 0o600); } catch (_) {}
    return target;
  }

  function hasPriorSqliteEvidence() {
    if (fs.existsSync(storageMarkerFile)) return true;
    try {
      if (fs.readdirSync(backupDir).some(name => name.endsWith('.sqlite'))) return true;
      if (fs.readdirSync(migrationArchiveDir).some(name => name.endsWith('.json'))) return true;
      if (fs.readdirSync(supportDir).some(name => name.startsWith('lai-data.sqlite.failed-'))) return true;
    } catch (_) {}
    return false;
  }

  function writeStorageMarker() {
    const databaseId = metadataValue('database_id', '') || crypto.randomUUID();
    if (!metadataValue('database_id', '')) setMetadata('database_id', databaseId);
    const current = fs.existsSync(storageMarkerFile) ? (() => {
      try { return readJson(storageMarkerFile); } catch (_) { return {}; }
    })() : {};
    atomicWrite(storageMarkerFile, JSON.stringify({
      databaseId,
      initializedAt: current.initializedAt || new Date().toISOString(),
      lastOpenedAt: new Date().toISOString()
    }, null, 2));
  }

  function verifyStorageMarker() {
    if (!fs.existsSync(storageMarkerFile)) return;
    const marker = readJson(storageMarkerFile);
    const expected = String(marker.databaseId || '');
    const actual = metadataValue('database_id', '');
    if (expected && actual && expected !== actual) {
      throw new Error('SQLite database identity does not match the storage marker');
    }
  }

  function initializeStorage() {
    ensureStorage();
    const existed = fs.existsSync(databaseFile);
    if (!existed && hasPriorSqliteEvidence()) {
      storageMode = 'error';
      storageError = 'SQLite database is missing; automatic recovery from legacy JSON is disabled';
      database = null;
      return;
    }
    try {
      database = new DatabaseSync(databaseFile);
      createDatabaseSchema();
      if (!metadataValue('initialized', '')) {
        let sourceFile = '';
        if (fs.existsSync(dataFile)) sourceFile = dataFile;
        else if (fs.existsSync(seedDataFile)) sourceFile = seedDataFile;
        const payload = sourceFile ? readJson(sourceFile) : emptyDataPayload();
        const archive = sourceFile === dataFile ? archiveMigrationSource(sourceFile) : '';
        const result = writeStateToDatabase(payload, { migration: true });
        setMetadata('initialized', '1');
        setMetadata('migration_source', sourceFile || 'empty');
        setMetadata('migration_archive', archive || '');
        setMetadata('migration_counts', JSON.stringify(result.counts));
      }
      const integrity = databaseIntegrity();
      if (!integrity.ok) throw new Error(`SQLite integrity check failed: ${integrity.message}`);
      startupIntegrity = integrity;
      verifyStorageMarker();
      writeStorageMarker();
      storageRevision = Number(metadataValue('revision', '0'));
      storageMode = 'sqlite';
      storageError = '';
      try { fs.chmodSync(databaseFile, 0o600); } catch (_) {}
    } catch (error) {
      storageError = error.message || String(error);
      try { database?.close(); } catch (_) {}
      database = null;
      if (!existed && fs.existsSync(databaseFile)) {
        try { fs.renameSync(databaseFile, `${databaseFile}.failed-${timestamp()}`); } catch (_) {}
      }
      storageMode = 'error';
    }
  }

  function readCurrentPayload() {
    if (storageMode === 'sqlite') return readStateFromDatabase();
    throw new Error(storageError || 'storage unavailable');
  }

  function availableFileName(dir, base, ext) {
    // 同一秒里的多份备份按 -2、-3… 编号；删掉的编号不再复用，排序才能保持创建先后。
    const ending = `.${ext}`, prefix = base + '-';
    let last = 0;
    for (const name of fs.readdirSync(dir)) {
      if (name === base + ending) last = Math.max(last, 1);
      else if (name.startsWith(prefix) && name.endsWith(ending)) {
        const suffix = name.slice(prefix.length, -ending.length);
        if (/^\d+$/.test(suffix) && Number.isSafeInteger(Number(suffix))) last = Math.max(last, Number(suffix));
      }
    }
    return last ? `${base}-${last + 1}.${ext}` : `${base}.${ext}`;
  }

  // 备份文件名：自动 lai-data-时间.sqlite，大量删除前 before-delete-时间.sqlite，手动 manual-时间.sqlite，
  // 恢复备份前 before-restore-时间.sqlite。
  const BACKUP_NAME = /^(lai-data|before-delete|before-restore|manual)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d+))?\.sqlite$/;
  function parseBackupName(name) {
    const match = BACKUP_NAME.exec(name);
    if (!match) return null;
    const [, kind, y, mo, d, h, mi, s, seq] = match.map((part, index) => index > 1 && part !== undefined ? Number(part) : part);
    return { name, kind, time: new Date(y, mo - 1, d, h, mi, s).getTime(), day: `${match[2]}${match[3]}${match[4]}`,
      week: Math.floor((Math.floor(Date.UTC(y, mo - 1, d) / 86400000) + 3) / 7), stamp: match.slice(2, 8).join(''), seq: Number(seq || 1) };
  }
  function compareBackupNames(a, b) {
    const left = parseBackupName(a), right = parseBackupName(b);
    if (left && right) return right.stamp.localeCompare(left.stamp) || right.seq - left.seq || b.localeCompare(a);
    if (left || right) return left ? -1 : 1;
    return b.localeCompare(a);
  }
  // 分层保留自动备份：最新 24 份全留；最近 14 天每天留最新一份；最近 8 周每周留最新一份；
  // 刚做好的那份和最新一份总是留着。手动备份（manual-*）、恢复前的备份（before-restore-*）和旧的 .json 备份从不自动删除。
  // 大量删除前的备份（before-delete-*）不占上面的名额，至少留 30 天，过了 30 天才按时间删。
  // extraKeep：这次一定不删的备份（恢复时正要用的那份）。
  const BEFORE_DELETE_KEEP_MS = 30 * 86400000;
  function pruneBackups(keepName, extraKeep = []) {
    const now = Date.now(), DAY = 86400000;
    const all = fs.readdirSync(backupDir).map(parseBackupName).filter(Boolean);
    const entries = all.filter(entry => entry.kind === 'lai-data').sort((a, b) => compareBackupNames(a.name, b.name));
    const keep = new Set([keepName, ...extraKeep]);
    const expired = all.filter(entry => entry.kind === 'before-delete' && !keep.has(entry.name) && now - entry.time >= BEFORE_DELETE_KEEP_MS);
    entries.slice(0, 24).forEach(entry => keep.add(entry.name));
    const days = new Set(), weeks = new Set();
    for (const entry of entries) {
      const age = now - entry.time;
      if (age < 14 * DAY && !days.has(entry.day)) { days.add(entry.day); keep.add(entry.name); }
      if (age < 56 * DAY && !weeks.has(entry.week)) { weeks.add(entry.week); keep.add(entry.name); }
    }
    let removed = 0;
    for (const entry of [...entries, ...expired]) {
      if (keep.has(entry.name)) continue;
      fs.rmSync(path.join(backupDir, entry.name), { force: true });
      fs.rmSync(path.join(backupDir, entry.name) + '.attachments', { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  // 只认本机的相对地址 /attachments/...；https://别的网站/attachments/x.pdf 这类外部链接不是本机文件。
  function attachmentTargetFromUrl(fileUrl = '') {
    const text = String(fileUrl || '');
    if (!text.startsWith('/attachments/') || text.includes('\\')) throw new Error('unsupported attachment url');
    const parsed = new URL(text, 'http://127.0.0.1');
    if (parsed.origin !== 'http://127.0.0.1' || !parsed.pathname.startsWith('/attachments/')) throw new Error('unsupported attachment url');
    const relative = decodeURIComponent(parsed.pathname.replace(/^\/attachments\//, ''));
    const target = path.resolve(attachmentsDir, relative);
    const root = path.resolve(attachmentsDir);
    if (!target.startsWith(root + path.sep)) throw new Error('unsupported attachment path');
    return target;
  }

  function collectAttachmentRefs(value, refs = new Set()) {
    if (!value || typeof value !== 'object') return refs;
    if (Array.isArray(value)) {
      value.forEach(item => collectAttachmentRefs(item, refs));
      return refs;
    }
    ['fileUrl', 'thumbUrl', 'link'].forEach(key => {
      const url = value[key];
      if (!url) return;
      try {
        refs.add(attachmentTargetFromUrl(url));
      } catch (_) {}
    });
    Object.values(value).forEach(item => collectAttachmentRefs(item, refs));
    return refs;
  }

  // 读不懂的一行（JSON 坏了）不让整个备份失败：这一行照样在备份的数据库里，只是找不到它引用的附件；跳过并计数。
  function backupAttachmentRefs(file) {
    if (file.endsWith('.json')) return { refs: collectAttachmentRefs(readJson(file)), invalid: 0 };
    const backup = new DatabaseSync(file, { readOnly:true });
    try {
      const refs = new Set();
      let invalid = 0;
      const tables = new Set(backup.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
      for (const table of ['orders', 'customers', 'tracking_lookups', 'app_state', 'mail_account', 'mail_drafts', 'mail_draft_files', 'mail_templates', 'mail_bulk']) {
        if (!tables.has(table)) continue;
        for (const row of backup.prepare(`SELECT data_json FROM ${table}`).all()) {
          let data;
          try { data = JSON.parse(row.data_json); }
          catch (_) { invalid += 1; continue; }
          collectAttachmentRefs(data, refs);
        }
      }
      return { refs, invalid };
    } finally { backup.close(); }
  }
  // 复制备份引用到的附件。文件已经不在（被移走、删掉）时跳过并计数，不让整个备份失败。
  function copyBackupAttachments(backupFile) {
    const dir = backupFile + '.attachments';
    fs.mkdirSync(dir, { recursive:true, mode:0o700 });
    let count = 0, missing = 0;
    const { refs, invalid } = backupAttachmentRefs(backupFile);
    for (const source of refs) {
      const relative = path.relative(attachmentsDir, source);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid backup attachment path');
      let stat = null;
      try { stat = fs.lstatSync(source); } catch (_) {}
      if (!stat || !stat.isFile()) { missing += 1; continue; }
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive:true, mode:0o700 });
      // Independent copy (APFS may share immutable blocks), never a hard link.
      fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
      fs.chmodSync(target, 0o600);
      count += 1;
    }
    return { count, missing, invalid };
  }

  const BACKUP_INTERVAL_MS = 60 * 60 * 1000, BACKUP_RETRY_MS = 60 * 1000;
  // 备份已经做好、但备份记录（backup-meta.json）没写进去时，先记在内存里，下次读记录时再写一次。
  let unsavedMeta = null;
  function writeBackupMeta(meta) {
    unsavedMeta = meta;
    try { atomicWrite(backupMetaFile, JSON.stringify(meta, null, 2)); unsavedMeta = null; return true; }
    catch (_) { return false; }
  }
  function backupMeta() {
    if (unsavedMeta) { writeBackupMeta(unsavedMeta); if (unsavedMeta) return unsavedMeta; }
    try { return fs.existsSync(backupMetaFile) ? readJson(backupMetaFile) : {}; } catch (_) { return {}; }
  }
  // 上次做到一半被打断（比如退出时被强行结束）留下的 *.partial 和 *.partial.attachments 删掉。
  function removePartialBackups() {
    try {
      for (const name of fs.readdirSync(backupDir)) {
        if (name.endsWith('.partial') || name.endsWith('.partial.attachments'))
          fs.rmSync(path.join(backupDir, name), { recursive: true, force: true });
      }
    } catch (_) { /* 清不掉不影响备份本身。 */ }
  }
  function performBackup(force = false, kind = 'auto', keep = []) {
    ensureStorage();
    if (storageMode !== 'sqlite' || !database) return { ok: false, message: storageError || 'SQLite unavailable' };
    removePartialBackups();
    const meta = backupMeta();
    const now = Date.now();
    // 上次备份的时间比现在还晚（电脑时间被往回调过）时，当作该备份了。
    const last = Number(meta.lastBackupAt || 0);
    if (!force && last && now >= last && now - last < BACKUP_INTERVAL_MS) {
      return { ok: true, skipped: true };
    }
    const extension = 'sqlite';
    const prefix = ['manual', 'before-delete', 'before-restore'].includes(kind) ? kind : 'lai-data';
    const backupName = availableFileName(backupDir, `${prefix}-${timestamp()}`, extension);
    const backupFile = path.join(backupDir, backupName);
    const stagingFile = backupFile + '.partial';
    database.exec('PRAGMA wal_checkpoint(FULL)');
    const quoted = stagingFile.replaceAll("'", "''");
    let copied, coveredMailRevision = 0, coveredBusinessRevision = 0;
    try {
      database.exec(`VACUUM INTO '${quoted}'`);
      fs.chmodSync(stagingFile, 0o600);
      const snapshot = new DatabaseSync(stagingFile, { readOnly:true });
      try {
        coveredMailRevision = Number(snapshot.prepare("SELECT value FROM metadata WHERE key = 'mail_backup_revision'").get()?.value || 0);
        coveredBusinessRevision = Number(snapshot.prepare("SELECT value FROM metadata WHERE key = 'business_backup_revision'").get()?.value || 0);
      } finally { snapshot.close(); }
      copied = copyBackupAttachments(stagingFile);
      fs.renameSync(stagingFile + '.attachments', backupFile + '.attachments');
      fs.renameSync(stagingFile, backupFile);
    } catch (error) {
      fs.rmSync(stagingFile, { force:true });
      fs.rmSync(stagingFile + '.attachments', { recursive:true, force:true });
      fs.rmSync(backupFile + '.attachments', { recursive:true, force:true });
      throw error;
    }
    // 备份文件已经做好：后面删旧备份、写备份记录出错，都不算这次备份失败。
    try { pruneBackups(backupName, keep); }
    catch (error) { console.warn('Lai: removing old backups failed:', error.message); }
    const metaSaved = writeBackupMeta({ lastBackupAt: now, lastBackupFile: backupFile, lastMailRevision: coveredMailRevision, lastBusinessRevision: coveredBusinessRevision, missingAttachments: copied.missing, invalidRows: copied.invalid });
    return { ok:true, file:backupFile, kind, attachmentsDir:backupFile + '.attachments', attachmentCount: copied.count, missingAttachments: copied.missing, invalidRows: copied.invalid, metaSaved };
  }

  // 备份队列：保存成功后不马上复制整个数据库，而是在上次备份满一小时时做一份（期间的改动合在一起）；
  // 失败后一分钟重试。“有没有没备份的改动”记在数据库的 metadata 里，关闭后下次打开接着排队。
  let backupFailure = '', backupTimer = null, backupTimerAt = 0;
  function backupPending(meta = backupMeta()) {
    return !!database && (Number(metadataValue('mail_backup_revision', '0')) > Number(meta.lastMailRevision || 0)
      || Number(metadataValue('business_backup_revision', '0')) > Number(meta.lastBusinessRevision || 0));
  }
  function backupStatus() {
    const meta = backupMeta();
    return { ok: !(backupFailure || meta.lastError), message: backupFailure || meta.lastError || '', lastSuccessfulAt: meta.lastBackupAt || 0,
      pending: backupPending(meta), nextAttemptAt: backupTimerAt, missingAttachments: Number(meta.missingAttachments || 0), invalidRows: Number(meta.invalidRows || 0) };
  }
  function cancelBackupTimer() {
    if (backupTimer) clearTimeout(backupTimer);
    backupTimer = null; backupTimerAt = 0;
  }
  // 截止时间定下来后，后面的保存不会把它往后推，最后一次改动最晚一小时内进备份。
  function queueBackup() {
    try {
      const meta = backupMeta();
      if (!backupPending(meta)) { cancelBackupTimer(); return; }
      if (backupTimer) return;
      const now = Date.now(), last = Number(meta.lastBackupAt || 0);
      const earliest = backupFailure || meta.lastError ? Number(meta.failedAt || now) + BACKUP_RETRY_MS
        : last > now ? now : last + BACKUP_INTERVAL_MS;
      backupTimerAt = Math.max(now + 2000, earliest);
      backupTimer = setTimeout(() => {
        backupTimer = null; backupTimerAt = 0;
        if (!database) return;
        const latest = backupMeta();
        createBackup(!!(backupFailure || latest.lastError));
      }, backupTimerAt - now);
      backupTimer.unref?.();
    } catch (_) {
      // 排队失败不影响已经保存好的数据，只在页面上提示。
      backupTimer = null; backupTimerAt = 0;
      backupFailure = '自动备份排队失败，请手动重试';
    }
  }
  function createBackup(force = false, kind = 'auto', keep = []) {
    let result;
    try {
      result = performBackup(force, kind, keep);
      if (result.ok && !result.skipped) backupFailure = '';
    } catch (error) {
      cancelBackupTimer();
      backupFailure = error.message || 'automatic backup failed';
      // 磁盘满时失败记录也可能写不进去，那就先记在内存里。
      writeBackupMeta({ ...backupMeta(), lastError: backupFailure, failedAt: Date.now() });
      result = { ok:false, message:backupFailure };
    }
    queueBackup();
    return { ...result, ...backupStatus(), ...(result.ok === false ? { ok:false, message:result.message } : {}) };
  }
  // 一次删掉 5 个以上客户或订单前，先做一份备份；备份没成功就不删。
  const LARGE_DELETE = 5;
  function backupBeforeLargeDelete(removedCustomers, removedOrders) {
    if (removedCustomers <= LARGE_DELETE && removedOrders <= LARGE_DELETE) return null;
    const result = createBackup(true, 'before-delete');
    if (!result.ok) throw httpError(503, '删除前的备份没有成功，这次改动没有保存。请稍后再试。', { code: 'backup_before_delete_failed' });
    return result;
  }
  function existingKeys() {
    return {
      customers: new Set(database.prepare('SELECT name FROM customers').all().map(row => row.name)),
      orders: new Set(database.prepare('SELECT id FROM orders').all().map(row => row.id)),
    };
  }
  function removalsInReplacement(raw) {
    const data = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' ? raw.data : raw;
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!object(data) || !object(data.customers) || !Array.isArray(data.orders)) return { customers: 0, orders: 0 };
    const existing = existingKeys();
    const wantedOrders = new Set(orderBuckets.flatMap(bucket => Array.isArray(data[bucket]) ? data[bucket] : []).map(order => String(order?.id || '').trim()));
    return {
      customers: [...existing.customers].filter(name => !Object.hasOwn(data.customers, name)).length,
      orders: [...existing.orders].filter(id => !wantedOrders.has(id)).length,
    };
  }
  function removalsInChanges(changes) {
    const existing = existingKeys();
    const list = value => Array.isArray(value) ? [...new Set(value.map(String))] : [];
    return {
      customers: list(changes?.customers?.remove).filter(name => existing.customers.has(name)).length,
      orders: list(changes?.orders?.remove).filter(id => existing.orders.has(id)).length,
    };
  }

  function commitMailWrite(write) {
    requireDatabase();
    database.exec('BEGIN IMMEDIATE');
    try {
      write();
      setMetadata('mail_backup_revision', String(Number(metadataValue('mail_backup_revision', '0')) + 1));
      database.exec('COMMIT');
    } catch (error) { try { database.exec('ROLLBACK'); } catch (_) {} throw error; }
    queueBackup();
  }

  function backupSummary() {
    ensureStorage();
    const backups = fs.readdirSync(backupDir)
      .filter(name => name.endsWith('.json') || name.endsWith('.sqlite'))
      .sort(compareBackupNames);
    const lastFile = path.basename(backupMeta().lastBackupFile || '');
    return {
      count: backups.length,
      sqliteCount: backups.filter(name => name.endsWith('.sqlite')).length,
      jsonCount: backups.filter(name => name.endsWith('.json')).length,
      manualCount: backups.filter(name => name.startsWith('manual-')).length,
      latest: backups.includes(lastFile) ? lastFile : backups[0] || null
    };
  }

  // ---- 从备份恢复 ----
  // 设置页「本地数据」列出备份，选一份恢复。恢复会把整个数据库（客户、订单、设置、邮件账号和草稿等）换成备份里的那份；
  // 换之前先把现在的数据做一份 before-restore 备份（从不自动删除）。规则写在 VALIDATION.md。
  const BACKUP_KIND_LABELS = { 'lai-data': 'auto', manual: 'manual', 'before-delete': 'before-delete', 'before-restore': 'before-restore' };
  const RESTORE_TEMP = /^\.lai-data\.sqlite\.restore-[A-Za-z0-9-]+\.tmp(?:-journal)?$/;
  const backupUnusable = () => httpError(422, '这份备份已损坏或不完整，不能用来恢复。现在的数据没有改动。', { code: 'backup_unusable' });
  const backupUnsafe = () => httpError(400, '这份备份文件不是来财自己做的普通文件，为了安全没有使用。现在的数据没有改动。', { code: 'backup_unsafe' });
  // 恢复做到一半被打断（比如断电）留下的临时文件：那时现在的数据库还没被换掉，临时文件可以直接删。
  function removeRestoreLeftovers() {
    try {
      for (const name of fs.readdirSync(supportDir)) if (RESTORE_TEMP.test(name)) fs.rmSync(path.join(supportDir, name), { force: true });
    } catch (_) { /* 清不掉不影响数据。 */ }
  }
  // 只认备份文件夹里按备份规则命名的普通文件：名字里不能有路径，不能是符号链接或硬链接（和数据目录的检查一样）。
  function backupFileFor(name) {
    const text = typeof name === 'string' ? name : '';
    if (!text || text.length > 200 || /[\\/\0]/.test(text) || text !== path.basename(text) || !parseBackupName(text))
      throw httpError(400, '找不到这份备份。', { code: 'invalid_backup_name' });
    const dirStat = fs.lstatSync(backupDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw backupUnsafe();
    const file = path.join(backupDir, text);
    if (path.dirname(file) !== backupDir) throw httpError(400, '找不到这份备份。', { code: 'invalid_backup_name' });
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (_) { throw httpError(404, '找不到这份备份，可能已经被删掉了。', { code: 'backup_not_found' }); }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1) throw backupUnsafe();
    return { file, stat };
  }
  // 复制时不跟随符号链接（O_NOFOLLOW），打开后再查一次是不是普通文件、有没有硬链接；目标必须是新文件，写完 fsync。
  function copyFileNoFollow(source, target) {
    const input = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let output;
    try {
      const stat = fs.fstatSync(input);
      if (!stat.isFile() || stat.nlink > 1) throw backupUnsafe();
      output = fs.openSync(target, 'wx', 0o600);
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let read;
      while ((read = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
        let offset = 0;
        while (offset < read) offset += fs.writeSync(output, buffer, offset, read - offset);
      }
      fs.fsyncSync(output);
    } finally {
      fs.closeSync(input);
      if (output !== undefined) fs.closeSync(output);
    }
  }
  function fsyncFile(file) {
    const descriptor = fs.openSync(file, 'r+');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  }
  function fsyncDirectory(dir) {
    let descriptor;
    try { descriptor = fs.openSync(dir, 'r'); fs.fsyncSync(descriptor); }
    catch (_) { /* 有的系统不能对文件夹 fsync；改名本身已经是原子的。 */ }
    finally { if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch (_) {} }
  }

  // 每份备份：时间、种类、大小、客户数和订单数（只读打开）。读不了的也列出来，ok:false，页面上不给恢复按钮。
  // 同一秒里做的不同种类的备份（比如手动备份后马上恢复）名字里的时间一样，按文件写入时间排先后。
  function listBackups() {
    ensureStorage();
    const written = name => { try { return fs.lstatSync(path.join(backupDir, name)).mtimeMs; } catch (_) { return 0; } };
    const names = fs.readdirSync(backupDir).filter(name => parseBackupName(name)).map(name => ({ name, parsed: parseBackupName(name), written: written(name) }));
    names.sort((a, b) => b.parsed.stamp.localeCompare(a.parsed.stamp) || b.written - a.written || compareBackupNames(a.name, b.name));
    return names.map(({ name, parsed }) => {
      const entry = { name, kind: BACKUP_KIND_LABELS[parsed.kind], time: new Date(parsed.time).toISOString(), size: 0, customers: null, orders: null, ok: false };
      try {
        const { file, stat } = backupFileFor(name);
        entry.size = stat.size;
        const backup = new DatabaseSync(file, { readOnly: true });
        try {
          entry.customers = Number(backup.prepare('SELECT COUNT(*) AS count FROM customers').get().count);
          entry.orders = Number(backup.prepare("SELECT COUNT(*) AS count FROM orders WHERE bucket = 'orders'").get().count);
          entry.ok = true;
        } finally { backup.close(); }
      } catch (_) { entry.customers = null; entry.orders = null; }
      return entry;
    });
  }

  // 备份能不能用：完整性检查通过；有现在的代码要读的表和列；是初始化过的来财数据库；每一行存的内容都读得懂（否则恢复后页面打不开）。
  const RESTORE_COLUMNS = {
    metadata: ['key', 'value'],
    orders: ['id', 'bucket', 'position', 'data_json'],
    customers: ['name', 'data_json'],
    tracking_lookups: ['id', 'position', 'data_json'],
    order_attachments: ['order_id', 'position', 'data_json'],
    order_logs: ['order_id', 'position', 'data_json'],
    app_state: ['key', 'data_json']
  };
  function checkRestorableDatabase(db) {
    let integrity;
    try { integrity = String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || ''); }
    catch (_) { throw backupUnusable(); }
    if (integrity !== 'ok') throw backupUnusable();
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
    for (const [table, columns] of Object.entries(RESTORE_COLUMNS)) {
      if (!tables.has(table)) throw backupUnusable();
      const present = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
      if (columns.some(column => !present.has(column))) throw backupUnusable();
    }
    const meta = key => db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value;
    if (String(meta('initialized') ?? '') !== '1') throw backupUnusable();
    const schema = meta('schema_version');
    if (schema !== undefined && String(schema) !== '1') throw backupUnusable();
    const revision = Number(meta('revision') ?? '0');
    if (!Number.isSafeInteger(revision) || revision < 0) throw backupUnusable();
    for (const table of ['orders', 'customers', 'tracking_lookups', 'app_state']) {
      for (const row of db.prepare(`SELECT data_json FROM ${table}`).iterate()) {
        try { JSON.parse(row.data_json); } catch (_) { throw backupUnusable(); }
      }
    }
    const buckets = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE bucket NOT IN ('orders','trashOrders','deletedOrders')").get();
    if (Number(buckets.count)) throw backupUnusable();
    return { revision, mailRevision: Number(meta('mail_backup_revision') ?? '0') || 0 };
  }

  // 把备份复制成数据目录里的临时文件，检查后在临时文件里写好版本号等记号；返回临时文件路径。出错时临时文件删掉，现在的数据不动。
  function prepareRestoreFile(backupFile, { liveRevision, liveMailRevision, databaseId, restoredFrom }) {
    const temp = path.join(supportDir, `.lai-data.sqlite.restore-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
      copyFileNoFollow(backupFile, temp);
      let db;
      try { db = new DatabaseSync(temp); }
      catch (_) { throw backupUnusable(); }
      let revision;
      try {
        // 备份是 VACUUM INTO 做的（回滚日志模式）；万一是 WAL 模式的文件，也先改成回滚日志，改完的文件不依赖 -wal。
        try { db.exec('PRAGMA journal_mode = DELETE'); } catch (_) { throw backupUnusable(); }
        const found = checkRestorableDatabase(db);
        // 恢复后的版本号比恢复前大：还开着旧页面的保存会收到 409（版本冲突），不会盖掉恢复的数据。
        revision = Math.max(liveRevision, found.revision) + 1;
        const mailRevision = Math.max(liveMailRevision, found.mailRevision) + 1;
        const set = db.prepare('INSERT INTO metadata(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        db.exec('BEGIN IMMEDIATE');
        try {
          set.run('revision', String(revision));
          // 恢复的数据要进下一次自动备份；邮件记号也往上走，免得之后的邮件改动比“已备份到的版本”小而漏备份。
          set.run('business_backup_revision', String(revision));
          set.run('mail_backup_revision', String(mailRevision));
          // 和数据目录里的标记文件对得上（sqlite-storage.json 记的是这个编号），重新打开时不会被当成别的数据库。
          if (databaseId) set.run('database_id', databaseId);
          set.run('last_saved_at', new Date().toISOString());
          set.run('restored_from', restoredFrom);
          set.run('restored_at', new Date().toISOString());
          db.exec('COMMIT');
        } catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; }
        if (String(db.prepare('PRAGMA quick_check').get()?.quick_check || '') !== 'ok') throw backupUnusable();
      } finally { db.close(); }
      fsyncFile(temp);
      return { temp, revision };
    } catch (error) {
      fs.rmSync(temp, { force: true });
      fs.rmSync(temp + '-journal', { force: true });
      throw error;
    }
  }

  // 备份里带着的附件，现在附件文件夹里没有的复制回去；已有的文件不覆盖，也从不删除现在的附件。
  function restoreBackupAttachments(backupFile) {
    const sourceRoot = backupFile + '.attachments';
    let rootStat;
    try { rootStat = fs.lstatSync(sourceRoot); } catch (_) { return 0; }
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return 0;
    const liveRoot = path.resolve(attachmentsDir);
    let copied = 0;
    const walk = dir => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const source = path.join(dir, item.name);
        if (item.isSymbolicLink()) continue;
        if (item.isDirectory()) { walk(source); continue; }
        if (!item.isFile()) continue;
        const relative = path.relative(sourceRoot, source);
        const target = path.resolve(liveRoot, relative);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !target.startsWith(liveRoot + path.sep)) continue;
        try { fs.lstatSync(target); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        // 附件文件夹里的上级目录也不能是符号链接。
        let parent = liveRoot;
        for (const part of path.relative(liveRoot, path.dirname(target)).split(path.sep).filter(Boolean)) {
          parent = path.join(parent, part);
          let stat = null;
          try { stat = fs.lstatSync(parent); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (!stat) fs.mkdirSync(parent, { mode: 0o700 });
          else if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe attachment folder');
        }
        const staging = path.join(path.dirname(target), `.${path.basename(target)}.restore-${crypto.randomBytes(6).toString('hex')}.tmp`);
        try {
          copyFileNoFollow(source, staging);
          // 复制途中别处放进来了同名文件：保留那一份。
          let appeared = true;
          try { fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') appeared = false; else throw error; }
          if (appeared) { fs.rmSync(staging, { force: true }); continue; }
          fs.renameSync(staging, target);
        } catch (error) { fs.rmSync(staging, { force: true }); throw error; }
        copied += 1;
      }
    };
    walk(sourceRoot);
    return copied;
  }

  // 别的程序（比如又启动了一次来财）还开着同一份数据库时不能换文件：它手里的是旧文件，换掉之后它照样往旧文件里存，
  // 存的东西谁也看不到，而且它不会报错。规则写在 VALIDATION.md。
  const dataInUse = () => httpError(409, '电脑上还开着另一个来财，也在用这份数据。请先关掉它再恢复（只关网页不够）。现在的数据没有改动。', { code: 'data_in_use' });
  // 关掉现在的连接，返回是不是只有这一个连接开着数据库。
  // 判断的办法：只剩这一个连接时，SQLite 关闭时会把 -wal 合进数据库并删掉 -wal；还有别的连接时它拿不到独占锁，-wal 会留下来
  // （哪怕是空的）。所以关掉后 -wal 还在，就当作还有别的连接。查不了（不是“文件不存在”的错误）也当作还有，宁可不恢复。
  function closeDatabaseAlone() {
    cancelBackupTimer();
    if (database) {
      try { database.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) { /* 有别的连接在读时可能做不完；下面看 -wal 判断。 */ }
      database.close();
      database = null;
    }
    storageMode = 'initializing';
    try { fs.lstatSync(databaseFile + '-wal'); return false; }
    catch (error) { return error.code === 'ENOENT'; }
  }
  // 恢复一开始（还什么都没做）先查一次：关掉、看一眼、马上按正常流程重新打开。换文件前还会再查一次。
  function requireOnlyConnection() {
    const alone = closeDatabaseAlone();
    initializeStorage();
    if (!alone) throw dataInUse();
    requireDatabase();
  }

  // 把准备好的临时文件换成正式数据库。顺序保证任何时刻断电，数据目录里都有一份完整的数据库：
  // 1. 做 TRUNCATE 检查点后关掉现在的连接，旧库的内容全在 lai-data.sqlite 里；
  // 2. 关掉后 -wal 还在（还有别的连接开着这份数据，或检查点没做完）就停下，重新打开旧库，什么都没变；
  // 3. beforeRename（恢复时把备份里缺的附件复制回来）；
  // 4. 删掉旧库的 -wal 和 -shm（必须在改名之前：留着旧的 -wal，新库打开时会把旧的改动套上去）；
  // 5. 改名（原子操作）把临时文件换成 lai-data.sqlite，再 fsync 文件夹；
  // 6. 按正常启动的流程重新打开（建缺的表、完整性检查、核对标记文件）。打不开时 database 是 null，由调用的人处理。
  // 改名之前出错：临时文件删掉，重新打开旧库，什么都没变。改名之后出错的错误带 databaseSwapped: true。
  function swapInDatabase(temp, beforeRename) {
    const wal = databaseFile + '-wal', shm = databaseFile + '-shm';
    let renamed = false;
    try {
      if (!closeDatabaseAlone()) throw dataInUse();
      if (beforeRename) beforeRename();
      fs.rmSync(wal, { force: true });
      fs.rmSync(shm, { force: true });
      fs.renameSync(temp, databaseFile);
      renamed = true;
      fsyncDirectory(supportDir);
    } catch (error) {
      if (!renamed) {
        fs.rmSync(temp, { force: true });
        if (!database) initializeStorage();
      } else if (error && typeof error === 'object') error.databaseSwapped = true;
      throw error;
    } finally {
      if (renamed) initializeStorage();
    }
  }

  function restoreBackup(name) {
    ensureStorage();
    requireDatabase();
    removeRestoreLeftovers();
    const { file } = backupFileFor(name);
    const backupName = path.basename(file);
    // 1. 先复制、检查、准备好（这时还没碰现在的数据）。
    const prepared = prepareRestoreFile(file, {
      liveRevision: Number(metadataValue('revision', '0')),
      liveMailRevision: Number(metadataValue('mail_backup_revision', '0')) || 0,
      databaseId: metadataValue('database_id', ''),
      restoredFrom: backupName
    });
    let before = null, swapped = false;
    try {
      // 2. 还有别的来财开着这份数据就不恢复（这时什么都还没改，也不做恢复前的备份）。
      requireOnlyConnection();
      // 3. 把现在的数据先做一份备份；这份没成功就不恢复。正在用的那份备份这次不会被清理掉。
      before = createBackup(true, 'before-restore', [backupName]);
      if (!before.ok || !before.file) throw httpError(503, '恢复前的备份没有成功，这次没有恢复，现在的数据没有改动。请稍后再试。', { code: 'backup_before_restore_failed' });
      // 备份文件和它在 backups/ 里的名字都要先落到磁盘上，再换数据库。
      try { fsyncFile(before.file); }
      catch (_) { throw httpError(503, '恢复前的备份没能写到磁盘上，这次没有恢复，现在的数据没有改动。请稍后再试。', { code: 'backup_before_restore_failed' }); }
      fsyncDirectory(backupDir);
      // 4. 换数据库。换之前（已经确认没有别的连接）把备份里有、现在缺的附件复制回来（只添不删，多出来的文件不影响现在的数据）。
      let attachments = 0;
      swapInDatabase(prepared.temp, () => {
        try { attachments = restoreBackupAttachments(file); }
        catch (_) { throw httpError(500, '备份里的附件没能复制回来，这次没有恢复，现在的数据没有改动。', { code: 'restore_attachments_failed' }); }
      });
      swapped = true;
      if (!database || storageMode !== 'sqlite') {
        // 换上的库打不开（不该发生：换之前检查过）：把恢复前的那份换回来，换完再看一次是不是真的打开了。
        const beforeName = path.basename(before.file);
        try {
          const rollback = prepareRestoreFile(before.file, { liveRevision: prepared.revision, liveMailRevision: 0, databaseId: '', restoredFrom: beforeName });
          swapInDatabase(rollback.temp);
        } catch (_) { /* 下面按实际状态说明。 */ }
        if (database && storageMode === 'sqlite') {
          queueBackup();
          throw httpError(500, `恢复没有成功，已换回恢复前的数据。恢复前的数据另外也存了一份：${beforeName}。`, { code: 'restore_failed', beforeRestore: beforeName });
        }
        throw restoreIncomplete(beforeName);
      }
      queueBackup();
      let revision = prepared.revision;
      try { revision = Number(metadataValue('revision', String(prepared.revision))); } catch (_) {}
      return { ok: true, revision, restoredFrom: backupName, beforeRestore: path.basename(before.file), attachmentsRestored: attachments };
    } catch (error) {
      fs.rmSync(prepared.temp, { force: true });
      // 关库时取消了自动备份的排队；库还开着就重新排上。
      if (database && storageMode === 'sqlite') queueBackup();
      if (Number.isInteger(error.status)) throw error;
      // 文件已经换掉之后出的错：不能说“没有改动”。
      if ((swapped || error.databaseSwapped) && before?.file) throw restoreIncomplete(path.basename(before.file));
      throw httpError(500, /[一-鿿]/.test(String(error.message || '')) ? error.message : '恢复没有成功，现在的数据没有改动。请稍后再试。', { code: 'restore_failed' });
    }
  }
  // 数据库文件已经换掉、又没能换回来（几乎不会发生）：说实话，并说出恢复前那份备份的名字。
  function restoreIncomplete(beforeName) {
    return httpError(500, `恢复没有完成，现在的数据暂时打不开。恢复前的数据已经另存为备份 ${beforeName}（在数据文件夹的 backups 里），请不要删除它，也先不要再操作来财，找人帮忙用这份备份恢复。`, { code: 'restore_incomplete', beforeRestore: beforeName });
  }

  function readSnapshot() {
    ensureStorage();
    if (!database || storageMode !== 'sqlite') throw httpError(503, storageError || 'storage unavailable');
    database.exec('BEGIN');
    try {
      storageRevision = Number(metadataValue('revision', '0'));
      const payload = { ...readCurrentPayload(), revision: storageRevision };
      database.exec('COMMIT');
      return payload;
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  // 版本号对不上的保存会被拒绝（409），这种情况不用先备份。
  const revisionMatches = baseRevision => Number(baseRevision) === Number(metadataValue('revision', '0'));
  function save(payload, options = {}) {
    ensureStorage();
    if (!database || storageMode !== 'sqlite') throw httpError(503, storageError || 'storage unavailable');
    if (revisionMatches(options.baseRevision)) {
      const removed = removalsInReplacement(payload);
      backupBeforeLargeDelete(removed.customers, removed.orders);
    }
    return writeStateToDatabase(payload, options);
  }

  function saveChanges(changes, options = {}) {
    ensureStorage();
    if (!database || storageMode !== 'sqlite') throw httpError(503, storageError || 'storage unavailable');
    if (revisionMatches(options.baseRevision)) {
      const removed = removalsInChanges(changes);
      backupBeforeLargeDelete(removed.customers, removed.orders);
    }
    return applyChanges(changes, options);
  }

  function readImportLog(id) {
    if (!database || storageMode !== 'sqlite') throw httpError(503, storageError || 'storage unavailable');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || '')))
      throw httpError(400, 'invalid import log id');
    const row = database.prepare('SELECT data_json FROM import_logs WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'import log not found');
    return JSON.parse(row.data_json);
  }

  // 绑定的邮箱账号单独存一行，不属于 /api/data 的业务快照，也不随 /api/save 改动。
  // 按用户决定，凭据以明文存放在本机数据库（文件权限 0600），因此数据库备份文件里也包含它。
  function requireDatabase() {
    if (!database || storageMode !== 'sqlite') throw httpError(503, storageError || 'storage unavailable');
  }
  function readMailAccount() {
    requireDatabase();
    const row = database.prepare('SELECT data_json FROM mail_account WHERE id = 1').get();
    if (!row) return null;
    try { return JSON.parse(row.data_json); } catch (_) { return null; }
  }
  function writeMailAccount(account) {
    commitMailWrite(() => {
      database.prepare(`
        INSERT INTO mail_account(id, data_json) VALUES(1, ?)
        ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json
      `).run(JSON.stringify(account));
    });
  }
  function deleteMailAccount() {
    commitMailWrite(() => {
      database.prepare('DELETE FROM mail_account WHERE id = 1').run();
    });
  }

  // 本机草稿：只存在这台电脑上，不同步到邮箱服务器的草稿箱。
  function listMailDrafts() {
    requireDatabase();
    return database.prepare('SELECT data_json FROM mail_drafts ORDER BY updated_at DESC, id').all()
      .map(row => { try { return JSON.parse(row.data_json); } catch (_) { return null; } }).filter(Boolean);
  }
  // files 不是 undefined 时，草稿和它的附件在同一个事务里写，不会一个成功一个失败。
  function writeMailDraft(draft, files) {
    commitMailWrite(() => {
      database.prepare(`
        INSERT INTO mail_drafts(id, updated_at, data_json) VALUES(?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data_json = excluded.data_json
      `).run(String(draft.id), String(draft.updatedAt), JSON.stringify(draft));
      if (files !== undefined) replaceMailDraftFiles(draft.id, files);
    });
  }
  function deleteMailDraft(id) {
    commitMailWrite(() => {
      database.prepare('DELETE FROM mail_drafts WHERE id = ?').run(String(id));
      database.prepare('DELETE FROM mail_draft_files WHERE draft_id = ?').run(String(id));
    });
  }
  // 草稿的附件单独存一张表：列草稿箱时不用把附件内容读出来。
  function readMailDraftFiles(id) {
    requireDatabase();
    const row = database.prepare('SELECT data_json FROM mail_draft_files WHERE draft_id = ?').get(String(id));
    if (!row) return [];
    try { const files = JSON.parse(row.data_json); return Array.isArray(files) ? files : []; } catch (_) { return []; }
  }
  function writeMailDraftFiles(id, files) {
    commitMailWrite(() => replaceMailDraftFiles(id, files));
  }
  function replaceMailDraftFiles(id, files) {
    if (!Array.isArray(files) || !files.length) { database.prepare('DELETE FROM mail_draft_files WHERE draft_id = ?').run(String(id)); return; }
    database.prepare(`
      INSERT INTO mail_draft_files(draft_id, data_json) VALUES(?, ?)
      ON CONFLICT(draft_id) DO UPDATE SET data_json = excluded.data_json
    `).run(String(id), JSON.stringify(files));
  }

  // 邮件模板：只存在这台电脑上。
  function listMailTemplates() {
    requireDatabase();
    return database.prepare('SELECT data_json FROM mail_templates ORDER BY updated_at DESC, id').all()
      .map(row => { try { return JSON.parse(row.data_json); } catch (_) { return null; } }).filter(Boolean);
  }
  function writeMailTemplate(template) {
    commitMailWrite(() => {
      database.prepare(`
        INSERT INTO mail_templates(id, updated_at, data_json) VALUES(?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data_json = excluded.data_json
      `).run(String(template.id), String(template.updatedAt), JSON.stringify(template));
    });
  }
  function deleteMailTemplate(id) {
    commitMailWrite(() => {
      database.prepare('DELETE FROM mail_templates WHERE id = ?').run(String(id));
    });
  }

  // 群发批次记录：每批的主题、正文、收件人及各自的发送结果。
  function listMailBulk() {
    requireDatabase();
    return database.prepare('SELECT data_json FROM mail_bulk ORDER BY created_at DESC, id').all()
      .map(row => { try { return JSON.parse(row.data_json); } catch (_) { return null; } }).filter(Boolean);
  }
  function readMailBulk(id) {
    requireDatabase();
    const row = database.prepare('SELECT data_json FROM mail_bulk WHERE id = ?').get(String(id));
    if (!row) return null;
    try { return JSON.parse(row.data_json); } catch (_) { return null; }
  }
  function writeMailBulk(batch) {
    commitMailWrite(() => {
      database.prepare(`
        INSERT INTO mail_bulk(id, created_at, data_json) VALUES(?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json
      `).run(String(batch.id), String(batch.createdAt), JSON.stringify(batch));
    });
  }

  // 页面会经常调用 /api/health：这里只做便宜的检查（数据库能不能查询、各表条数），
  // 完整性检查（PRAGMA integrity_check）只在启动时做一次，结果记在 startupIntegrity 里。
  function health() {
    let integrity = storageMode === 'sqlite' ? startupIntegrity : { ok: false, message: storageError || storageMode };
    let counts = null;
    if (integrity.ok) {
      try {
        storageRevision = Number(metadataValue('revision', '0'));
        const count = sql => Number(database.prepare(sql).get().count);
        counts = {
          orders: count("SELECT COUNT(*) AS count FROM orders WHERE bucket = 'orders'"),
          trashOrders: count("SELECT COUNT(*) AS count FROM orders WHERE bucket = 'trashOrders'"),
          deletedOrders: count("SELECT COUNT(*) AS count FROM orders WHERE bucket = 'deletedOrders'"),
          customers: count('SELECT COUNT(*) AS count FROM customers'),
          trackingLookups: count('SELECT COUNT(*) AS count FROM tracking_lookups')
        };
      } catch (error) { integrity = { ok: false, message: error.message || 'storage unavailable' }; }
    }
    return {
      ok: integrity.ok, storageMode, storageRevision, storageError, integrity,
      dataFile: storageMode === 'sqlite' ? databaseFile : dataFile,
      legacyJsonFile: fs.existsSync(dataFile) ? dataFile : '',
      backupDir, backups: backupSummary(), backup: backupStatus(),
      counts
    };
  }

  function close() {
    if (!database) return;
    // 关闭时不做备份（Mac 外壳 2 秒后会强行结束进程，备份可能做到一半）。
    // 没备份的改动记在数据库里，下次打开会重新排队。
    cancelBackupTimer();
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    database.close();
    database = null;
  }

  initializeStorage();
  removeRestoreLeftovers();
  if (database && storageMode === 'sqlite') {
    removePartialBackups();
    // 旧数据库还没有“业务改动已备份到哪个版本”的记号：把当前版本记上，排一次备份覆盖它（只改备份记号，不动业务数据）。
    if (!metadataValue('business_backup_revision', '')) setMetadata('business_backup_revision', metadataValue('revision', '0'));
    // 邮件数据同理：已有邮件数据而没有记号时，记一次待备份。
    if (!metadataValue('mail_backup_revision', '') && ['mail_account', 'mail_drafts', 'mail_draft_files', 'mail_templates', 'mail_bulk']
      .some(table => database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())) setMetadata('mail_backup_revision', '1');
    queueBackup();
  }
  return { readSnapshot, save, saveChanges, readImportLog, readMailAccount, writeMailAccount, deleteMailAccount, listMailDrafts, writeMailDraft, deleteMailDraft, readMailDraftFiles, writeMailDraftFiles, listMailTemplates, writeMailTemplate, deleteMailTemplate, listMailBulk, readMailBulk, writeMailBulk, backup: createBackup, backupStatus, listBackups, restoreBackup, health, close, directory: supportDir };
}
module.exports = { openStorage };
