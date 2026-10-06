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
  const supportDir = laiDataDirectory();
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

  function ensureStorage() {
    laiDataDirectory();
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

  function writeStateToDatabase(rawPayload, { migration = false, baseRevision, importLog } = {}) {
    if (!database) throw new Error('SQLite database is not available');
    const payload = normalizeDataPayload(rawPayload);
    const data = payload.data;
    const validatedImportLog = normalizeImportLog(importLog, data);
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
      }
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
    let index = 1;
    let name = `${base}.${ext}`;
    while (fs.existsSync(path.join(dir, name))) {
      index += 1;
      name = `${base}-${index}.${ext}`;
    }
    return name;
  }

  function attachmentTargetFromUrl(fileUrl = '') {
    const parsed = new URL(String(fileUrl || ''), 'http://127.0.0.1');
    if (!parsed.pathname.startsWith('/attachments/')) throw new Error('unsupported attachment url');
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

  function backupAttachmentRefs(file) {
    if (file.endsWith('.json')) return collectAttachmentRefs(readJson(file));
    const backup = new DatabaseSync(file, { readOnly:true });
    try {
      const refs = new Set();
      const tables = new Set(backup.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
      for (const table of ['orders', 'customers', 'tracking_lookups', 'app_state']) {
        if (!tables.has(table)) continue;
        for (const row of backup.prepare(`SELECT data_json FROM ${table}`).all()) {
          collectAttachmentRefs(JSON.parse(row.data_json), refs);
        }
      }
      return refs;
    } finally { backup.close(); }
  }
  let backupMissing = 0;
  function copyBackupAttachments(backupFile) {
    backupMissing = 0;
    const dir = backupFile + '.attachments';
    fs.mkdirSync(dir, { recursive:true, mode:0o700 });
    let count = 0;
    for (const source of backupAttachmentRefs(backupFile)) {
      const relative = path.relative(attachmentsDir, source);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid backup attachment path');
      // 商机附件的文件如果已经不在（被手动移走、删除时没删成功的反例等），不让整个备份失败：跳过并计数。
      if (relative.split(path.sep)[0] === 'opportunities' && !fs.existsSync(source)) { backupMissing += 1; continue; }
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive:true, mode:0o700 });
      // Independent copy (APFS may share immutable blocks), never a hard link.
      fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
      fs.chmodSync(target, 0o600);
      count += 1;
    }
    return count;
  }
  function createBackup(force = false) {
    ensureStorage();
    if (storageMode !== 'sqlite' || !database) return { ok: false, message: storageError || 'SQLite unavailable' };
    let meta = {};
    if (fs.existsSync(backupMetaFile)) {
      try { meta = readJson(backupMetaFile); } catch (_) {}
    }
    const now = Date.now();
    if (!force && meta.lastBackupAt && now - meta.lastBackupAt < 60 * 60 * 1000) {
      return { ok: true, skipped: true };
    }
    const extension = 'sqlite';
    const backupName = availableFileName(backupDir, `lai-data-${timestamp()}`, extension);
    const backupFile = path.join(backupDir, backupName);
    const stagingFile = backupFile + '.partial';
    database.exec('PRAGMA wal_checkpoint(FULL)');
    const quoted = stagingFile.replaceAll("'", "''");
    let attachmentCount;
    try {
      database.exec(`VACUUM INTO '${quoted}'`);
      fs.chmodSync(stagingFile, 0o600);
      attachmentCount = copyBackupAttachments(stagingFile);
      fs.renameSync(stagingFile + '.attachments', backupFile + '.attachments');
      fs.renameSync(stagingFile, backupFile);
    } catch (error) {
      fs.rmSync(stagingFile, { force:true });
      fs.rmSync(stagingFile + '.attachments', { recursive:true, force:true });
      fs.rmSync(backupFile + '.attachments', { recursive:true, force:true });
      throw error;
    }
    const backups = fs.readdirSync(backupDir)
      .filter(name => name.endsWith(`.${extension}`))
      .sort()
      .reverse();
    backups.slice(30).forEach(name => {
      fs.rmSync(path.join(backupDir, name), { force:true });
      fs.rmSync(path.join(backupDir, name) + '.attachments', { recursive:true, force:true });
    });
    atomicWrite(backupMetaFile, JSON.stringify({ lastBackupAt: now, lastBackupFile: backupFile }, null, 2));
    return { ok:true, file:backupFile, attachmentsDir:backupFile + '.attachments', attachmentCount, missingAttachments:backupMissing };
  }

  function backupSummary() {
    ensureStorage();
    const backups = fs.readdirSync(backupDir)
      .filter(name => name.endsWith('.json') || name.endsWith('.sqlite'))
      .sort()
      .reverse();
    return {
      count: backups.length,
      sqliteCount: backups.filter(name => name.endsWith('.sqlite')).length,
      jsonCount: backups.filter(name => name.endsWith('.json')).length,
      latest: backups[0] || null
    };
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

  function save(payload, options) {
    ensureStorage();
    if (!database || storageMode !== 'sqlite') throw httpError(503, storageError || 'storage unavailable');
    return writeStateToDatabase(payload, options);
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
    requireDatabase();
    database.prepare(`
      INSERT INTO mail_account(id, data_json) VALUES(1, ?)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json
    `).run(JSON.stringify(account));
  }
  function deleteMailAccount() {
    requireDatabase();
    database.prepare('DELETE FROM mail_account WHERE id = 1').run();
  }

  // 本机草稿：只存在这台电脑上，不同步到邮箱服务器的草稿箱。
  function listMailDrafts() {
    requireDatabase();
    return database.prepare('SELECT data_json FROM mail_drafts ORDER BY updated_at DESC, id').all()
      .map(row => { try { return JSON.parse(row.data_json); } catch (_) { return null; } }).filter(Boolean);
  }
  function writeMailDraft(draft) {
    requireDatabase();
    database.prepare(`
      INSERT INTO mail_drafts(id, updated_at, data_json) VALUES(?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data_json = excluded.data_json
    `).run(String(draft.id), String(draft.updatedAt), JSON.stringify(draft));
  }
  function deleteMailDraft(id) {
    requireDatabase();
    database.prepare('DELETE FROM mail_drafts WHERE id = ?').run(String(id));
    database.prepare('DELETE FROM mail_draft_files WHERE draft_id = ?').run(String(id));
  }
  // 草稿的附件单独存一张表：列草稿箱时不用把附件内容读出来。
  function readMailDraftFiles(id) {
    requireDatabase();
    const row = database.prepare('SELECT data_json FROM mail_draft_files WHERE draft_id = ?').get(String(id));
    if (!row) return [];
    try { const files = JSON.parse(row.data_json); return Array.isArray(files) ? files : []; } catch (_) { return []; }
  }
  function writeMailDraftFiles(id, files) {
    requireDatabase();
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
    requireDatabase();
    database.prepare(`
      INSERT INTO mail_templates(id, updated_at, data_json) VALUES(?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data_json = excluded.data_json
    `).run(String(template.id), String(template.updatedAt), JSON.stringify(template));
  }
  function deleteMailTemplate(id) {
    requireDatabase();
    database.prepare('DELETE FROM mail_templates WHERE id = ?').run(String(id));
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
    requireDatabase();
    database.prepare(`
      INSERT INTO mail_bulk(id, created_at, data_json) VALUES(?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json
    `).run(String(batch.id), String(batch.createdAt), JSON.stringify(batch));
  }

  function health() {
    const integrity = storageMode === 'sqlite' ? databaseIntegrity() : { ok: false, message: storageError || storageMode };
    storageRevision = Number(metadataValue('revision', '0'));
    return {
      ok: integrity.ok, storageMode, storageRevision, storageError, integrity,
      dataFile: storageMode === 'sqlite' ? databaseFile : dataFile,
      legacyJsonFile: fs.existsSync(dataFile) ? dataFile : '',
      backupDir, backups: backupSummary(),
      counts: integrity.ok ? stateCounts(readCurrentPayload()) : null
    };
  }

  function close() {
    if (!database) return;
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    database.close();
    database = null;
  }

  initializeStorage();
  return { readSnapshot, save, readImportLog, readMailAccount, writeMailAccount, deleteMailAccount, listMailDrafts, writeMailDraft, deleteMailDraft, readMailDraftFiles, writeMailDraftFiles, listMailTemplates, writeMailTemplate, deleteMailTemplate, listMailBulk, readMailBulk, writeMailBulk, backup: createBackup, health, close, directory: supportDir };
}
module.exports = { openStorage };
