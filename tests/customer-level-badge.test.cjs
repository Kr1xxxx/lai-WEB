const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const model = require("../src/model.js");
const css = fs.readFileSync(
  path.join(__dirname, "../src/customer-replica.css"),
  "utf8",
);

test("customer names are prefixed by the TOS level emoji", () => {
  assert.match(app, /function customerLevelForRow\(c\)/);
  assert.match(app, /return c\.displayLevel \?\? M\.customerLevelForRow\(c\)/);
  for (const [total,orderCount,expected] of [
    [100001,1,"A级钻石客户"], [50000,1,"B级翡翠客户"],
    [10000,2,"C级白金客户"], [1000,2,"D级黄金客户"],
    [999,2,"E级白银客户"], [999,1,"F级青铜客户"],
  ]) assert.equal(model.customerLevelForRow({total,orderCount}),expected);
  assert.match(app, /class="level-icon \$\{levelIconClass\(customerLevel\)\}"/);
  assert.match(app, /aria-label="客户等级：\$\{E\(customerLevel\)\}"/);
  assert.match(app, /\$\{badge\}<button class="company-link"/);
  assert.doesNotMatch(app, /class="company-symbol"/);
  assert.doesNotMatch(app, />⬡<\/span>/);
});

test("level icons use the same emoji set as TOS", () => {
  assert.match(css, /\.level-icon::before\s*\{[^}]*font-size:\s*11\.2px/s);
  assert.match(css, /\.level-icon\.level-a::before\s*\{[^}]*content:\s*"💎"/s);
  assert.match(css, /\.level-icon\.level-b::before\s*\{[^}]*content:\s*"🟢"/s);
  assert.match(css, /\.level-icon\.level-c::before\s*\{[^}]*content:\s*"🔷"/s);
  assert.match(css, /\.level-icon\.level-d::before\s*\{[^}]*content:\s*"🟡"/s);
  assert.match(css, /\.level-icon\.level-e::before\s*\{[^}]*width:\s*10\.4px[^}]*height:\s*10\.4px[^}]*radial-gradient/s);
  assert.match(css, /\.level-icon\.level-f::before\s*\{[^}]*content:\s*"🟤"/s);
  assert.match(css, /\.level-icon\.level-custom::before\s*\{[^}]*content:\s*"🔹"/s);
  assert.doesNotMatch(css, /\.customer-level-badge\s*\{/);
  assert.doesNotMatch(css, /\.company-symbol\s*\{/);
});
