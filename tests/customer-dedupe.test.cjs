"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const CS = require("../src/customer-settings-model.js");
const M = require("../src/model.js");
const L = require("../src/modules.js");

const base = () => ({ customers: {}, orders: [] });
const make = (state, name, fields) => M.upsertCustomer(state, "", { name, country: "US", source: "展会", ...fields });
const withModes = (state, patch) => CS.setDedupe(state, { ...CS.get(state).dedupe, ...patch });

test("defaults: customer code blocks, email and phone allow, the rest off", () => {
  assert.deepEqual(CS.get(base()).dedupe, { customerCode: "block", email: "allow", phone: "allow", landline: "off", socialAccount: "off", website: "off", shortName: "off", companyAddress: "off", alibabaId: "off" });
});

test("blocked email: a new customer with the same email is refused, naming the other customer", () => {
  let s = withModes(base(), { email: "block" });
  s = make(s, "A公司", { email: "Buyer@Example.com" });
  assert.throws(() => make(s, "B公司", { email: "buyer@example.com" }), /邮箱和已有客户「A公司」相同/);
  assert.doesNotThrow(() => make(s, "C公司", { email: "other@example.com" }));
});

test("allow and off modes never block", () => {
  let s = make(base(), "A公司", { email: "a@x.com", phone: "1234567890" });
  assert.doesNotThrow(() => make(s, "B公司", { email: "a@x.com", phone: "123-456-7890" }));
  s = withModes(s, { email: "off" });
  assert.doesNotThrow(() => make(s, "C公司", { email: "a@x.com" }));
});

test("phones compare by digits only; short numbers are ignored", () => {
  let s = withModes(base(), { phone: "block", landline: "block" });
  s = make(s, "A公司", { phone: "+1 (234) 567-890", landline: "123" });
  assert.throws(() => make(s, "B公司", { phone: "1234567890" }), /联系电话和已有客户「A公司」相同/);
  assert.doesNotThrow(() => make(s, "C公司", { landline: "123" }));
});

test("only new values are checked: an old duplicate does not block editing the customer", () => {
  let s = make(base(), "A公司", { email: "a@x.com" });
  s = make(s, "B公司", { email: "a@x.com" });
  s = withModes(s, { email: "block" });
  assert.doesNotThrow(() => M.upsertCustomer(s, "B公司", { name: "B公司", note: "改备注" }));
  s = make(s, "D公司", { email: "d@x.com" });
  assert.throws(() => M.upsertCustomer(s, "B公司", { name: "B公司", extraContacts: [{ id: "n", email: "D@x.com" }] }), /邮箱和已有客户「D公司」相同/);
});

test("trashed customers do not count; customer code blocks by default", () => {
  let s = make(base(), "A公司", { customerCode: "C-001" });
  assert.throws(() => make(s, "B公司", { customerCode: "c-001" }), /客户编号和已有客户「A公司」相同/);
  s = { ...s, customers: { ...s.customers, "A公司": { ...s.customers["A公司"], laiBucket: "trash" } } };
  assert.doesNotThrow(() => make(s, "B公司", { customerCode: "C-001" }));
});

test("setDedupe rejects an unknown mode and the duplicates page lists extra fields once they are checked", () => {
  assert.throws(() => CS.setDedupe(base(), { ...CS.get(base()).dedupe, email: "maybe" }), /邮箱/);
  let s = make(base(), "A公司", { website: "x.com" });
  s = make(s, "B公司", { website: "x.com" });
  assert.equal(L.findDuplicates(s, CS.get(s).dedupe).length, 0);
  const groups = L.findDuplicates(s, withModes(s, { website: "allow" }) && CS.get(withModes(s, { website: "allow" })).dedupe);
  assert.deepEqual(groups.map((g) => [g.type, g.value]), [["公司网址", "x.com"]]);
});

test("sources: unconfigured gives no list; two levels, hide, sort, rename follows customers, delete refuses while in use", () => {
  const LM = require("../src/lead-model.js");
  let s = base();
  assert.equal(CS.sourceChoices(s), null);
  assert.ok(LM.sourceNames(s).includes("展会"), "old suggestions stay until a list is made");
  s = CS.addSource(s, { name: "常规获客" });
  s = CS.addSource(s, { name: "社媒" });
  const top = CS.get(s).sources;
  s = CS.addSource(s, { name: "展会", parentId: top[0].id });
  s = CS.addSource(s, { name: "熟人介绍", parentId: top[0].id });
  assert.throws(() => CS.addSource(s, { name: "展会", parentId: top[0].id }), /同名/);
  assert.throws(() => CS.addSource(s, { name: "a/b" }), /“\/”/);
  assert.deepEqual(CS.sourceChoices(s), ["常规获客 / 展会", "常规获客 / 熟人介绍", "社媒"]);
  assert.deepEqual(LM.sourceNames(s), CS.sourceChoices(s));
  const kids = CS.get(s).sources[0].children;
  s = CS.setSourceHidden(s, kids[1].id, true);
  assert.deepEqual(CS.sourceChoices(s), ["常规获客 / 展会", "社媒"]);
  s = CS.moveSource(s, CS.get(s).sources[1].id, -1);
  assert.deepEqual(CS.sourceChoices(s), ["社媒", "常规获客 / 展会"]);
  s = make(s, "A公司", { source: "常规获客 / 展会" });
  assert.throws(() => CS.deleteSource(s, CS.get(s).sources[1].children[0].id), /1 位客户/);
  s = CS.renameSource(s, CS.get(s).sources[1].id, "常规");
  assert.equal(s.customers["A公司"].source, "常规 / 展会");
  s = CS.setSourceHidden(s, CS.get(s).sources[0].id, true);
  assert.deepEqual(CS.sourceChoices(s), ["常规 / 展会"]);
  s = CS.deleteSource(s, CS.get(s).sources[0].id);
  assert.equal(CS.get(s).sources.length, 1);
});
