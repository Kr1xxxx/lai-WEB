const test = require('node:test');
const assert = require('node:assert/strict');
const Editor = require('../src/customer-editor-ui.js');

// A native date field cannot display these already-stored values. The real
// browser acceptance verifies that ordinary saves preserve their full records.
for (const value of ['1990-01-02T00:00:00Z', '1990/01/02', '1990-02-30', '0000-01-02', '1990\n-01-02']) {
  test('old date remains editable instead of becoming an empty calendar: ' + JSON.stringify(value), () => {
    const body = Editor.render({name:'Legacy', birthday:value, nextFollow:value,
      extraContacts:[{id:'extra', contact:'Extra', birthday:value}]}, {state:{customers:{},orders:[]}}).body;
    for (const name of ['birthday', 'birthdayExtra', 'nextFollow']) {
      const tag = body.match(new RegExp('<input[^>]*name="' + name + '"[^>]*>'))?.[0];
      assert.ok(tag, name + ' exists');
      assert.match(tag, /type="text"/, name + ' exposes old text instead of native sanitization');
    }
  });
}
test('new empty and ordinary valid dates retain the existing calendar input', () => {
  for (const birthday of ['', '2000-02-29', '2026-10-03']) {
    const body = Editor.render({name:'Standard',birthday,nextFollow:birthday}, {state:{customers:{},orders:[]}}).body;
    for (const name of ['birthday','nextFollow'])
      assert.match(body.match(new RegExp('<input[^>]*name="' + name + '"[^>]*>'))[0], /type="date"/);
  }
});
