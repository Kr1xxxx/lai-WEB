const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path'); const crypto=require('node:crypto'); const zlib=require('node:zlib'); const {createRequire}=require('node:module');
const SOURCE=path.resolve(process.env.LAI_AUDIT_SOURCE || path.join(__dirname,'..'));
const client=require(path.join(SOURCE,'backend/mail-client.js')); const smtp=require(path.join(SOURCE,'backend/mail-smtp.js')); const {createMailService}=require(path.join(SOURCE,'backend/mail-service.js'));
const testFile=path.join(SOURCE,'tests/mail-ui.test.cjs'); const testSource=fs.readFileSync(testFile,'utf8');
const {harness,ACCOUNT}=new Function('require', testSource.slice(0,testSource.indexOf("test('navigation"))+';return {harness,ACCOUNT};')(createRequire(testFile));
async function staleAccountRetry() {
  const originalOpen = client.open;
  let account = { email: 'account-a@example.invalid' }, failOld, entered, stall = false, alive = true;
  const enteredOld = new Promise(resolve => { entered = resolve; });
  const operations = [];
  client.open = async captured => ({
    server: { host: 'in-process-fake' },
    usable: () => captured.email === 'account-a@example.invalid' ? alive : true,
    close: async () => {},
    withMailbox: async (_mailbox, _readOnly, task) => task(),
    addFlags: async (uids, flags) => {
      operations.push({ account: captured.email, uids, flags });
      if (stall && captured.email === 'account-a@example.invalid') {
        entered();
        await new Promise((_, reject) => { failOld = reject; });
      }
    },
  });
  const service = createMailService({ store: { readMailAccount: () => account }, keepAliveMs: 10000 });
  try {
    // Warm the pooled connection; only reused sessions are automatically retried.
    await service.flags({ box: 'inbox', uid: 1, seen: true });
    stall = true;
    const pending = service.flags({ box: 'inbox', uid: 7, seen: true });
    await enteredOld;
    account = { email: 'account-b@example.invalid' };
    await service.forget();
    alive = false;
    failOld(Object.assign(new Error('Synthetic lost connection'), { code: 'network' }));
    await assert.rejects(pending, e => e.status === 409);
    assert.equal(operations.some(o => o.account === "account-b@example.invalid"), false);
    /* assert.deepEqual(operations.at(-1), { account: 'account-b@example.invalid', uids: [7], flags: ['\\Seen'] }); */
    return { operations };
  } finally { await service.shutdown(); client.open = originalOpen; }
}

async function staleRelatedCache() {
  let release, activeAccount = ACCOUNT;
  const h = harness({ routes: {
    '/api/mail-account': ({ reply }) => reply(200, { ok: true, account: activeAccount }),
    '/api/mail-account/unbind': ({ reply }) => { activeAccount = null; return reply(200, { ok: true, account: null }); },
    '/api/mail-account/bind': ({ payload, reply }) => { activeAccount = { ...ACCOUNT, email: payload.email }; return reply(200, { ok: true, account: activeAccount }); },
    '/api/mail/correspondence': ({ reply }) => activeAccount.email === 'account-b@example.invalid' ? reply(200, {ok:true,items:[]}) : new Promise(resolve => { release = () => resolve(reply(200, {
      ok: true, items: [{ box: 'inbox', uid: 41, subject: 'OLD ACCOUNT SYNTHETIC PRIVATE SUBJECT', snippet: 'Old account synthetic body', date: '2026-10-07', from: { address: 'customer@example.invalid' }, to: [] }],
    })); }),
  }});
  try {
    await h.mail.select();
    const pending = h.mail.loadCustomerPanel('Nordic Lamps AB');
    await h.act('unbind-confirm');
    // Normal UI binding action, with a fully in-process mocked account endpoint.
    h.act('bind');
    const form = h.form('mail-bind-form');
    form.elements.email.value = 'account-b@example.invalid';
    form.elements.password.value = crypto.randomBytes(24).toString('hex');
    await h.submit('mail-bind-form');
    release();
    await pending;
    await h.mail.loadCustomerPanel('Nordic Lamps AB');
    const containsOldAccountSubject = h.mail.customerPanel('Nordic Lamps AB').includes('OLD ACCOUNT SYNTHETIC PRIVATE SUBJECT');
    const requestCount = h.calls('/api/mail/correspondence').length;
    assert.equal(h.mail.account().email, 'account-b@example.invalid');
    assert.equal(containsOldAccountSubject, false);
    assert.equal(requestCount, 2);
    return { currentAccount: h.mail.account().email, containsOldAccountSubject, correspondenceRequestsAcrossBothAccounts: requestCount };
  } finally { h.dispose(); }
}

// Construct a valid synthetic PNG below the editor's 2 MiB image limit.
function largePng() {
  const width = 900, height = 620;
  const crc32 = data => {
    let crc = 0xffffffff;
    for (const value of data) {
      crc ^= value;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, payload) => {
    const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
    size.writeUInt32BE(payload.length); crc.writeUInt32BE(crc32(Buffer.concat([name, payload])));
    return Buffer.concat([size, name, payload, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const scanlines = Buffer.alloc((width * 3 + 1) * height, 180);
  for (let row = 0; row < height; row++) scanlines[row * (width * 3 + 1)] = 0;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scanlines, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
  return { png, width, height };
}

async function inlineImageTruncation() {
  const originalSend = smtp.send;
  let outbound;
  smtp.send = async value => { outbound = value.mail; return { messageId: '<fake@example.invalid>', accepted: ['recipient@example.invalid'], rejected: [] }; };
  const store = { readMailAccount: () => ({ email: 'account-a@example.invalid' }) };
  const service = createMailService({ store });
  try {
    const { png, width, height } = largePng();
    const html = `<div>BEFORE</div><img src="data:image/png;base64,${png.toString('base64')}"><div>AFTER_IMAGE_REQUIRED_CONTENT</div>`;
    assert.ok(png.length < 2 * 1024 * 1024);
    await assert.rejects(service.send({ to: 'recipient@example.invalid', subject: 'Synthetic quotation', text: 'tail', html }), e => e.status === 413);
    assert.equal(outbound, undefined);
    assert.throws(() => service.saveDraft({subject:'large',html}), e => e.status === 413);
  } finally { smtp.send = originalSend; await service.shutdown(); }
}

async function bulkPersistenceFailure() {
  const originalSend = smtp.send;
  let accepted = 0, serialized, writes = 0;
  smtp.send = async () => { accepted++; return { messageId: '<fake@example.invalid>', accepted: ['synthetic@example.invalid'], rejected: [] }; };
  const store = {
    readMailAccount: () => ({ email: 'account-a@example.invalid' }),
    writeMailBulk: batch => {
      writes++;
      if (writes > 1) throw Object.assign(new Error('Synthetic disk full'), { code: 'SQLITE_FULL' });
      serialized = JSON.stringify(batch);
    },
    readMailBulk: () => JSON.parse(serialized), listMailBulk: () => [JSON.parse(serialized)],
  };
  const service = createMailService({ store, bulkPauseMs: 0 });
  try {
    const start = service.bulkStart({ subject: 'Synthetic bulk', text: 'Hello', recipients: [1,2,3].map(n => ({ address: `recipient-${n}@example.invalid` })) });
    await service.bulkIdle();
    const batch = service.bulkGet({ id: start.batch.id }).batch;
    assert.equal(accepted, 0);
    assert.equal(batch.status, 'stopped');
    assert.match(batch.stopReason, /记录|保存/);
  } finally { smtp.send = originalSend; await service.shutdown(); }
}

async function forwardingDraft() {
  const drafts = new Map(), files = new Map();
  // Draft and account boundaries use synthetic data.
  const service = createMailService({ store: {
    readMailAccount: () => null,
    listMailDrafts: () => [...drafts.values()],
    writeMailDraft: (d,f) => { drafts.set(d.id,d); if(f!==undefined) files.set(d.id,f); },
    writeMailDraftFiles: (id, f) => files.set(id, f),
    readMailDraftFiles: id => files.get(id) || [],
  }});
  const h = harness({ routes: {
    '/api/mail/drafts/save': ({ payload, reply }) => reply(200, service.saveDraft(payload)),
    '/api/mail/drafts': ({ reply }) => reply(200, service.drafts()),
    '/api/mail/draft': ({ query, reply }) => reply(200, service.getDraft(query)),
    '/api/mail/send': ({ reply }) => reply(200, { ok: true, recipients: ['boss@example.invalid'], rejected: [] }),
  }});
  try {
    await h.mail.select();
    await h.act('open', { box: 'inbox', uid: '4' });
    await h.act('forward');
    const form = h.form('mail-compose-form').elements;
    form.to.value = 'boss@example.invalid';
    form.forwardAttachments.checked = false;
    await h.act('compose-draft');
    const savedPayload = h.calls('/api/mail/drafts/save').at(-1).payload;
    const id = [...drafts.keys()][0];
    await h.act('compose-close');
    await h.mail.select('drafts');
    await h.act('draft-open', { id });
    const checkboxPresent = !!h.form('mail-compose-form').elements.forwardAttachments;
    await h.submit('mail-compose-form');
    const sent = h.calls('/api/mail/send').at(-1).payload;
    assert.equal(Object.hasOwn(savedPayload, 'forwardAttachments'), true);
    assert.equal(checkboxPresent, true);
    assert.equal(sent.forwardAttachments, false);
    assert.equal(sent.forwardOf.uid, 4);
    return {
      selectedBeforeSaving: false,
      savedForwardAttachmentsFieldPresent: Object.hasOwn(savedPayload, 'forwardAttachments'),
      checkboxPresentAfterReopen: checkboxPresent,
      outgoingForwardAttachments: sent.forwardAttachments,
      outgoingForwardOf: sent.forwardOf,
      actualSmtpCalls: 0,
    };
  } finally { h.dispose(); }
}

async function attachmentSaveRace() {
  let release;
  const h = harness({ routes: {
    '/api/mail/drafts/save': ({ payload, reply }) => release ? reply(200,{ok:true,draft:{...payload,id:'d'.repeat(32)}}) : new Promise(resolve => { release = () => resolve(reply(200, { ok: true, draft: { ...payload, id: 'd'.repeat(32) } })); }),
  }});
  try {
    await h.mail.select();
    await h.act('compose');
    h.form('mail-compose-form').elements.to.value = 'recipient@example.invalid';
    h.form('mail-compose-form').elements.subject.value = 'Quote';
    const file = { name: 'quote.txt', type: 'text/plain', size: 4, content: 'TEST', slow: true };
    h.node('mail-compose-file').files = [file];
    h.fire('mail-compose-file', 'change');
    const saving = h.act('compose-draft');
    const submittedAttachmentCount = h.calls('/api/mail/drafts/save')[0].payload.attachments.length;
    // Deterministic event order: FileReader finishes while the save is pending.
    file.finish();
    release();
    await saving;
    const dirtyAfterFileCompleted = h.mail.composeDirty();
    const leaveAllowed = await h.mail.leave();
    const saveRequestCount = h.calls('/api/mail/drafts/save').length;
    const lastSavedAttachmentCount = h.calls('/api/mail/drafts/save').at(-1).payload.attachments.length;
    assert.equal(submittedAttachmentCount, 0);
    assert.equal(dirtyAfterFileCompleted, true);
    assert.equal(leaveAllowed, true);
    assert.equal(saveRequestCount, 2);
    assert.equal(lastSavedAttachmentCount, 1);
    return { submittedAttachmentCount, dirtyAfterFileCompleted, leaveAllowed, saveRequestCount, lastSavedAttachmentCount };
  } finally { h.dispose(); }
}


test('old account operations cannot retry into a new account', staleAccountRetry);
test('old correspondence cannot enter new mailbox caches', staleRelatedCache);
test('encoded HTML capacity errors preserve content by rejecting send and save', inlineImageTruncation);
test('bulk fails before SMTP if pre-send checkpoint cannot persist', bulkPersistenceFailure);
test('forward attachment opt-out survives saving and reopening', forwardingDraft);
test('save baseline represents submitted attachments when FileReader finishes late', attachmentSaveRace);test('leaving keeps compose when edits arrive while draft saving is in flight',async()=>{let release;const h=harness({routes:{'/api/mail/drafts/save':({payload,reply})=>new Promise(r=>{release=()=>r(reply(200,{ok:true,draft:{...payload,id:'d'.repeat(32)}}));})}});try{await h.mail.select();await h.act('compose');const f=h.form('mail-compose-form').elements;f.subject.value='BEFORE';const leaving=h.mail.leave();f.subject.value='AFTER';release();assert.equal(await leaving,false);assert.equal(h.mail.composing(),true);assert.equal(h.mail.composeDirty(),true);assert.equal(h.calls('/api/mail/drafts/save')[0].payload.subject,'BEFORE');}finally{h.dispose();}});
test('SMTP accepted then record failure stops batch and restart never labels the in-flight message unsent',async()=>{const original=smtp.send;let accepted=0,writes=0,serialized;const store={readMailAccount:()=>({email:'a@example.invalid'}),writeMailBulk:b=>{if(++writes>2)throw Error('Synthetic full disk');serialized=JSON.stringify(b);},readMailBulk:()=>JSON.parse(serialized),listMailBulk:()=>[JSON.parse(serialized)]};smtp.send=async()=>{accepted++;return{accepted:['q@example.invalid'],rejected:[]};};let service=createMailService({store,bulkPauseMs:0});try{const result=service.bulkStart({subject:'S',text:'T',recipients:[1,2,3].map(n=>({address:`r${n}@example.invalid`}))});await service.bulkIdle();const batch=service.bulkGet({id:result.batch.id}).batch;assert.equal(accepted,1);assert.equal(batch.status,'stopped');assert.equal(batch.uncertain,1);assert.equal(batch.items[0].status,'uncertain');assert.equal(batch.skipped,2);await service.shutdown();service=createMailService({store});const restarted=service.bulkGet({id:result.batch.id}).batch;assert.equal(restarted.items[0].status,'uncertain');assert.match(restarted.items[0].error,/核对/);assert.equal(accepted,1);}finally{smtp.send=original;await service.shutdown();}});
test('oversize plain text and cumulative UTF8 HTML are rejected rather than truncated',async()=>{let sent=0;const original=smtp.send;smtp.send=async()=>{sent++;return{accepted:[],rejected:[]};};const service=createMailService({store:{readMailAccount:()=>({email:'a@example.invalid'})}});try{await assert.rejects(service.send({to:'q@example.invalid',subject:'S',text:'x'.repeat(1024*1024+1)}),e=>e.status===413);assert.throws(()=>service.saveDraft({subject:'S',html:'中'.repeat(800000)}),e=>e.status===413);assert.equal(sent,0);}finally{smtp.send=original;await service.shutdown();}});
