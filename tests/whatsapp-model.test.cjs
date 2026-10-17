'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/whatsapp-model.js');

test('DIAL_CODES covers the world and shares 1 across North America', () => {
  const codes = Object.keys(W.DIAL_CODES);
  assert.ok(codes.length >= 230 && codes.length <= 260, `rows: ${codes.length}`);
  for (const iso of codes) assert.match(iso, /^[A-Z]{2}$/);
  for (const value of Object.values(W.DIAL_CODES)) assert.match(value, /^[1-9]\d{0,3}$/);
  assert.equal(W.DIAL_CODES.US, '1');
  assert.equal(W.DIAL_CODES.CA, '1');
  assert.equal(W.DIAL_CODES.GB, '44');
  assert.equal(W.DIAL_CODES.CN, '86');
  assert.equal(W.DIAL_CODES.IT, '39');
  assert.equal(W.DIAL_CODES.PL, '48');
  assert.ok(Object.isFrozen(W.DIAL_CODES));
});

test('countryIso reads codes, flags, Chinese and English names the way the app stores them', () => {
  assert.equal(W.countryIso('GB'), 'GB');
  assert.equal(W.countryIso('gb'), 'GB');
  assert.equal(W.countryIso('🇬🇧 英国'), 'GB');
  assert.equal(W.countryIso('英国'), 'GB');
  assert.equal(W.countryIso('United Kingdom'), 'GB');
  assert.equal(W.countryIso('UK'), 'GB');
  assert.equal(W.countryIso('USA'), 'US');
  assert.equal(W.countryIso('美国'), 'US');
  assert.equal(W.countryIso('波兰'), 'PL');
  assert.equal(W.countryIso('Poland'), 'PL');
  assert.equal(W.countryIso('中国香港'), 'HK');
  assert.equal(W.countryIso(' '), '');
  assert.equal(W.countryIso('火星'), '');
  assert.equal(W.dialCodeOf('🇵🇱 波兰'), '48');
  assert.equal(W.dialCodeOf('nowhere'), '');
});

test('dialOptions lists every code once with a flag and names', () => {
  const options = W.dialOptions();
  assert.equal(options.length, Object.keys(W.DIAL_CODES).length);
  const uk = options.find(item => item.iso === 'GB');
  assert.equal(uk.code, '+44');
  assert.equal(uk.flag, '🇬🇧');
  assert.ok(uk.zh && uk.en);
});

test('toE164: plus, 00, contact code and country fallback', () => {
  assert.equal(W.toE164('+44 7700 900123'), '+447700900123');
  assert.equal(W.toE164('+44 (0)7700 900123'), '+447700900123');
  assert.equal(W.toE164('(+44) 7700-900123'), '+447700900123');
  assert.equal(W.toE164('0044 7700 900123'), '+447700900123');
  assert.equal(W.toE164('07700 900123', { code: '+44' }), '+447700900123');
  assert.equal(W.toE164('7700 900123', { code: '44' }), '+447700900123');
  assert.equal(W.toE164('07700 900123', { country: '🇬🇧 英国' }), '+447700900123');
  assert.equal(W.toE164('07700 900123', { country: 'United Kingdom' }), '+447700900123');
  // the contact's own code wins over the customer's country
  assert.equal(W.toE164('415 555 0100', { code: '+1', country: '英国' }), '+14155550100');
  assert.equal(W.toE164('138 0013 8000', { country: '中国' }), '+8613800138000');
  assert.equal(W.toE164('13800138000', { code: '+86' }), '+8613800138000');
});

test('toE164: trunk zero is dropped once, except in Italy', () => {
  assert.equal(W.toE164('0612345678', { country: 'DE' }), '+49612345678');
  assert.equal(W.toE164('00612345678', { country: 'DE' }), '+612345678'); // 00 means international, the country is ignored
  assert.equal(W.toE164('06 1234 5678', { country: 'IT' }), '+390612345678');
  assert.equal(W.toE164('+39 06 1234 5678'), '+390612345678');
  assert.equal(W.toE164('0049 0612345678'), '+490612345678'); // explicit international form is left alone
  assert.equal(W.toE164('8 916 123 45 67', { country: 'RU' }), '+79161234567');
});

test('toE164: a number that already starts with the code is not prefixed twice', () => {
  assert.equal(W.toE164('447700900123', { code: '+44' }), '+447700900123');
  assert.equal(W.toE164('14155550100', { country: 'US' }), '+14155550100');
  assert.equal(W.toE164('8613800138000', { country: 'CN' }), '+8613800138000');
  // a short national number that happens to begin with the code digits is still national
  assert.equal(W.toE164('392 1234567', { country: 'IT' }), '+393921234567');
});

test('toE164: length limits and bad input', () => {
  assert.equal(W.toE164('+1234567'), null); // 7 digits
  assert.equal(W.toE164('+12345678'), '+12345678'); // 8 digits is the minimum
  assert.equal(W.toE164('+123456789012345'), '+123456789012345'); // 15 is the maximum
  assert.equal(W.toE164('+1234567890123456'), null);
  assert.equal(W.toE164('+0123456789'), null);
  assert.equal(W.toE164('07700 900123'), null); // no code and no country: cannot know
  assert.equal(W.toE164('07700 900123', { country: 'nowhere' }), null);
  assert.equal(W.toE164(''), null);
  assert.equal(W.toE164(null), null);
  assert.equal(W.toE164('call me'), null);
  assert.equal(W.toE164('+44 7700 900123 ext 22'), '+447700900123');
  assert.equal(W.toE164('+44 7700 900123', { country: 'DE' }), '+447700900123');
  assert.equal(W.toE164('＋４４　７７００　９００１２３'), '+447700900123'); // full-width characters
  assert.equal(W.toE164('‪+44 7700 900123‬'), '+447700900123');
});

test('waLink builds an https wa.me link with an encoded message', () => {
  assert.equal(W.waLink('+447700900123'), 'https://wa.me/447700900123');
  assert.equal(W.waLink('+447700900123', ''), 'https://wa.me/447700900123');
  assert.equal(W.waLink('+447700900123', 'Hi Maria'), 'https://wa.me/447700900123?text=Hi%20Maria');
  const text = 'Hello 👋\nPrice: $5 & more? 100%\n你好';
  const link = W.waLink('+447700900123', text);
  assert.ok(link.startsWith('https://wa.me/447700900123?text='));
  assert.equal(decodeURIComponent(link.split('?text=')[1]), text);
  assert.match(link, /%0A/);
  assert.match(link, /%F0%9F%91%8B/);
  assert.equal(new URL(link).searchParams.get('text'), text);
  assert.equal(W.waLink('07700 900123', 'x'), '');
  assert.equal(W.waLink(null, 'x'), '');
});

test('renderTemplate fills the four variables and reports what is missing', () => {
  const vars = { 姓名: 'Maria', 公司: 'Lash Co', 我的名字: '李伟', 国家: '英国' };
  const full = W.renderTemplate('你好 {{姓名}}，我是 {{公司}} 的 {{我的名字}}。{{国家}} 市场见。{{姓名}}！', vars);
  assert.equal(full.text, '你好 Maria，我是 Lash Co 的 李伟。英国 市场见。Maria！');
  assert.deepEqual(full.missing, []);
  const partial = W.renderTemplate('Hi {{姓名}}, from {{ 公司 }} {{国家}} {{未知}} {{国家}}', { 姓名: 'Maria', 公司: ' ', 国家: '' });
  assert.equal(partial.text, 'Hi Maria, from {{ 公司 }} {{国家}} {{未知}} {{国家}}');
  assert.deepEqual(partial.missing, ['公司', '国家', '未知']);
  assert.deepEqual(W.renderTemplate('no variables', {}).missing, []);
  assert.equal(W.renderTemplate(undefined).text, '');
  assert.deepEqual(W.renderTemplate('{{姓名}}').missing, ['姓名']);
});

test('chatNameFromFile and peersFromSenders', () => {
  assert.equal(W.chatNameFromFile('WhatsApp Chat with Maria Test.zip'), 'Maria Test');
  assert.equal(W.chatNameFromFile('/tmp/WhatsApp Chat with Maria Test (2).txt'), 'Maria Test');
  assert.equal(W.chatNameFromFile('WhatsApp Chat - Maria Test.zip'), 'Maria Test');
  assert.equal(W.chatNameFromFile('WhatsApp 聊天 - 玛丽亚.zip'), '玛丽亚');
  assert.equal(W.chatNameFromFile('与玛丽亚的 WhatsApp 聊天.zip'), '玛丽亚');
  assert.equal(W.chatNameFromFile('notes.txt'), '');
  assert.deepEqual(W.peersFromSenders([{ name: '+44 7700 900123', count: 3 }, { name: 'Li Wei', count: 2 }, '‪+44 7700 900124‬', '+44 7700 900123']),
    ['+447700900123', '+447700900124']);
});

// ---------- matching ----------
const customer = (extra = {}) => ({ client: extra.client || 'X', ...extra });
const state = () => ({
  customers: {
    'Lash Co': customer({ client: 'Lash Co', country: '🇬🇧 英国', contacts: ['Maria Test'], contact: 'Maria Test', phone: '07700 900123', phones: ['07700 900123'], owner: 'Amy' }),
    'Beauty Bar': customer({ client: 'Beauty Bar', country: '美国', phone: '415 555 0100', phoneCountryCode: '+1', owner: 'Amy',
      additionalPhones: [{ phoneCountryCode: '+44', phone: '7700 900124' }],
      extraContacts: [{ id: 'c2', contact: 'Zoe Sample', phone: '7700 900125', phoneCountryCode: '+44', additionalPhones: [{ phoneCountryCode: '+44', phone: '7700 900126' }] }] }),
    'Old Style': customer({ client: 'Old Style', country: '波兰', contacts: [{ contact: 'Jan Przykład', phone: '600 100 200', phoneCountryCode: '+48' }] }),
    'No Country': customer({ client: 'No Country', phone: '7700 900199' }),
    'Hidden Co': customer({ client: 'Hidden Co', country: '英国', phone: '07700 900127', owner: 'Bob' }),
    'Trash Co': customer({ client: 'Trash Co', country: '英国', phone: '07700 900123', laiBucket: 'trash' }),
  },
  // 线索已去掉（D-030）：存着的 laiLeads 不再参与匹配
  laiLeads: [
    { id: 'l1', name: 'Lead One', contact: 'Nina Lead', phone: '07700 900130', country: '英国', status: 'new' },
    { id: 'l2', name: 'Lead Two', phone: '07700 900131', country: '英国', status: 'converted' },
    { id: 'l3', name: 'Lead Three', phone: '07700 900132', country: '英国', status: 'new', trashed: true },
  ],
});

test('matchCustomers finds customers by every kind of stored phone', () => {
  const s = state();
  const find = peer => W.matchCustomers(s, { peers: [peer] }).candidates.map(item => item.name);
  assert.deepEqual(find('+447700900123'), ['Lash Co']); // main phone through the country; trashed customer skipped
  assert.deepEqual(find('+14155550100'), ['Beauty Bar']); // main phone with its own code
  assert.deepEqual(find('+447700900124'), ['Beauty Bar']); // additionalPhones
  assert.deepEqual(find('+447700900125'), ['Beauty Bar']); // extra contact
  assert.deepEqual(find('+447700900126'), ['Beauty Bar']); // extra contact's additional phone
  assert.deepEqual(find('+48600100200'), ['Old Style']); // legacy contacts[]
  assert.deepEqual(find('+447700900127'), ['Hidden Co']);
  assert.deepEqual(find('+4915112345678'), []);
  const hit = W.matchCustomers(s, { peers: ['+447700900125'] }).candidates[0];
  assert.equal(hit.contact, 'Zoe Sample');
  assert.deepEqual(hit.reasons, ['phone']);
  assert.equal(hit.score, 100);
});

test('matchCustomers falls back to the national number when the stored one has no country', () => {
  const found = W.matchCustomers(state(), { peers: ['+447700900199'] }).candidates;
  assert.equal(found[0].name, 'No Country');
  assert.ok(found[0].score < 100);
});

test('matchCustomers matches names (NFKC, case, spaces) and ranks phone plus name first', () => {
  const s = state();
  const byName = W.matchCustomers(s, { names: ['  maria   TEST '] }).candidates;
  assert.equal(byName[0].name, 'Lash Co');
  assert.deepEqual(byName[0].reasons, ['contactName']);
  assert.equal(W.matchCustomers(s, { names: ['ＬＡＳＨ ｃｏ'] }).candidates[0].name, 'Lash Co'); // full-width
  const both = W.matchCustomers(s, { peers: ['+447700900125'], names: ['Zoe Sample', 'Lash'] }).candidates;
  assert.equal(both[0].name, 'Beauty Bar');
  assert.ok(both[0].score > 100);
  assert.deepEqual(both[0].reasons, ['phone', 'contactName']);
  assert.ok(both.length > 1 && both[1].score < both[0].score);
  assert.deepEqual(W.matchCustomers(s, { names: ['ab'] }).candidates, []);
  assert.deepEqual(W.matchCustomers(s, {}).candidates, []);
});

test('matchCustomers only looks at customers the account may see', () => {
  const s = state();
  const mine = name => s.customers[name].owner === 'Amy';
  assert.deepEqual(W.matchCustomers(s, { peers: ['+447700900127'], names: ['Hidden Co'] }, mine).candidates, []);
  assert.deepEqual(W.matchCustomers(s, { peers: ['+447700900124'] }, mine).candidates.map(item => item.name), ['Beauty Bar']);
  assert.deepEqual(W.matchCustomers(s, { peers: ['+447700900124'] }, () => false).candidates, []);
  const calls = [];
  W.matchCustomers(s, { peers: ['+447700900124'] }, name => { calls.push(name); return true; });
  assert.ok(!calls.includes('Trash Co'));
});

test('matchCustomers only looks at customers: stored leads are ignored (D-030)', () => {
  const s = state();
  const result = W.matchCustomers(s, { peers: ['+447700900130', '+447700900131', '+447700900132'], names: ['Nina Lead'] });
  assert.deepEqual(result, { candidates: [] });
});
